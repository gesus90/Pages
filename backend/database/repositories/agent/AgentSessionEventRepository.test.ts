import { beforeEach, expect, it, vi, type Mock } from "vitest";

import {
  appendSessionHistoryChunks,
  readSessionHistoryChunks,
} from "./AgentSessionHistoryChunks";
import { AgentSessionEventRepository } from "./AgentSessionEventRepository";

import type { AgentSessionDatabase } from "./AgentSessionDatabase";
import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type {
  NewAgentSessionEvent,
  StoredSessionEvents,
} from "@/backend/service/agents/sessions/AgentSessionStore";
import type {
  AgentSessionEvent,
  AgentSessionEventPage,
} from "@/definition/AgentSessionJournal";

const files = vi.hoisted(() => ({
  write: vi.fn<(planId: string, contents: string) => Promise<string>>(),
}));

vi.mock("@/backend/storage/AgentPayloadFileStore", () => ({
  requireAgentFiles: () => ({ write: files.write }),
}));

vi.mock("./AgentSessionHistoryChunks", () => ({
  appendSessionHistoryChunks: vi.fn(async () => {}),
  prepareSessionHistoryChunks: vi.fn(async () => []),
  readSessionHistoryChunks: vi.fn(async () => null),
}));

vi.mock("./AgentSessionRows", () => ({
  readStoredEventRow: async (
    ...[, row, attemptId]: [unknown, readonly DatabaseValue[], string]
  ) => ({
    id: `${attemptId}:${Number(row[0])}`,
    sequence: Number(row[0]),
  }),
}));

beforeEach(() => {
  vi.mocked(appendSessionHistoryChunks).mockClear();
  vi.mocked(readSessionHistoryChunks).mockReset();
  vi.mocked(readSessionHistoryChunks).mockResolvedValue(null);
  files.write.mockReset();
  files.write.mockImplementation(async (...[, contents]) => `file:${contents}`);
});

interface Scenario {
  attempt: DatabaseValue[] | null;
  /** Rows of the lock inside the transaction, one per attempt of a publication. */
  locked: (DatabaseValue[] | null)[];
  prepareDuplicates: string[];
  publishDuplicates: string[];
  eventRows: DatabaseValue[][];
  minimum: DatabaseValue[] | null;
  failure: Error | null;
}

function scenarioOf(overrides: Partial<Scenario> = {}): Scenario {
  return {
    attempt: [5, "s1", "l1", "p1"],
    locked: [[5, "s1", "l1"]],
    prepareDuplicates: [],
    publishDuplicates: [],
    eventRows: [],
    minimum: [null],
    failure: null,
    ...overrides,
  };
}

function databaseOf(scenario: Scenario): {
  readonly database: AgentSessionDatabase;
  readonly execute: Mock<DatabaseTransaction["execute"]>;
  readonly query: Mock<DatabaseTransaction["query"]>;
  readonly transactions: () => number;
} {
  let isInside = false;
  let locks = 0;
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {
    if (scenario.failure && isInside) throw scenario.failure;
  });
  const query = vi.fn<DatabaseTransaction["query"]>(
    async (statement, parameters) => {
      if (statement.includes("FOR UPDATE")) {
        const row =
          scenario.locked[Math.min(locks, scenario.locked.length - 1)];
        locks += 1;
        return row ? [row] : [];
      }
      if (statement.includes("dedupe_key = $dedupe_key")) {
        const duplicates = isInside
          ? scenario.publishDuplicates
          : scenario.prepareDuplicates;
        return duplicates.includes(String(parameters?.dedupe_key)) ? [[1]] : [];
      }
      if (statement.includes("plan_id")) {
        return scenario.attempt ? [scenario.attempt] : [];
      }
      if (statement.includes("MIN(sequence)")) {
        return scenario.minimum ? [scenario.minimum] : [];
      }
      return scenario.eventRows;
    },
  );
  let transactions = 0;
  const transaction: AgentSessionDatabase["transaction"] = async (work) => {
    transactions += 1;
    isInside = true;
    try {
      return await work({ execute, query });
    } finally {
      isInside = false;
    }
  };
  const database: AgentSessionDatabase = { execute, query, transaction };
  return { database, execute, query, transactions: () => transactions };
}

function newEvent(
  text: string,
  dedupeKey: string | null = null,
): NewAgentSessionEvent {
  return {
    turn: 1,
    kind: "status",
    text,
    isTruncated: false,
    createdAt: "t",
    dedupeKey,
  };
}

it("appends numbered events and prunes by retention", async () => {
  const { database, execute } = databaseOf(scenarioOf());
  const repository = new AgentSessionEventRepository(database);
  const stored = await repository.appendEvents(
    "a1",
    [newEvent("one"), newEvent("two")],
    10,
  );
  expect(
    stored.map((event) => [event.id, event.sequence, event.stepId]),
  ).toEqual([
    ["a1:5", 5, "s1"],
    ["a1:6", 6, "s1"],
  ]);
  const inserts = execute.mock.calls.filter(([statement]) =>
    statement.includes("INSERT INTO agent_session_events"),
  );
  expect(inserts.map(([, parameters]) => parameters)).toMatchObject([
    { sequence: 5, body: "", body_file: "file:one", dedupe_key: null },
    { sequence: 6, body_file: "file:two" },
  ]);
  expect(execute.mock.calls.at(-2)?.[1]).toEqual({
    attempt_id: "a1",
    next_sequence: 7,
  });
  expect(execute.mock.calls.at(-1)?.[1]).toEqual({
    attempt_id: "a1",
    first_kept: -3,
  });
  expect(appendSessionHistoryChunks).toHaveBeenCalledOnce();
});

it("drops repeated events and keeps keys with a NUL character apart", async () => {
  const { database, execute } = databaseOf(
    scenarioOf({ prepareDuplicates: ["old"] }),
  );
  const stored = await new AgentSessionEventRepository(database).appendEvents(
    "a1",
    [
      newEvent("a\u0000b", "new"),
      newEvent("again", "new"),
      newEvent("known", "old"),
      newEvent("nul", "k\u0000"),
    ],
    10,
  );
  expect(stored.map((event) => event.text)).toEqual(["a\u0000b", "nul"]);
  expect(files.write).toHaveBeenCalledWith("p1", "ab");
  const keys = execute.mock.calls
    .filter(([statement]) => statement.includes("INSERT INTO"))
    .map(([, parameters]) => parameters?.dedupe_key);
  expect(keys).toEqual([
    "new",
    `nul:${Buffer.from("k\u0000").toString("hex")}`,
  ]);
});

it("rejects an unknown attempt when preparing and when publishing", async () => {
  const unknown = "Unknown PageAgentCLI attempt";
  await expect(
    new AgentSessionEventRepository(
      databaseOf(scenarioOf({ attempt: null })).database,
    ).appendEvents("a1", [], 10),
  ).rejects.toThrow(unknown);
  await expect(
    new AgentSessionEventRepository(
      databaseOf(scenarioOf({ locked: [null] })).database,
    ).appendEvents("a1", [], 10),
  ).rejects.toThrow(unknown);
});

it("retries a publication after a concurrent numbering change", async () => {
  const { database, transactions } = databaseOf(
    scenarioOf({
      locked: [
        [6, "s1", "l1"],
        [5, "s1", "l1"],
      ],
    }),
  );
  const stored = await new AgentSessionEventRepository(database).appendEvents(
    "a1",
    [newEvent("one")],
    10,
  );
  expect(stored).toHaveLength(1);
  expect(transactions()).toBe(2);
});

it("gives up with a conflict after five changed launches", async () => {
  const { database, transactions } = databaseOf(
    scenarioOf({ locked: [[5, "s1", "other"]] }),
  );
  await expect(
    new AgentSessionEventRepository(database).appendEvents("a1", [], 10),
  ).rejects.toMatchObject({ code: "plan_conflict" });
  expect(transactions()).toBe(5);
});

it("retries when a repeated key appeared meanwhile", async () => {
  const { database } = databaseOf(scenarioOf({ publishDuplicates: ["k"] }));
  await expect(
    new AgentSessionEventRepository(database).appendEvents(
      "a1",
      [newEvent("one", "k")],
      10,
    ),
  ).rejects.toMatchObject({ code: "plan_conflict" });
});

it("passes other failures of a publication on", async () => {
  const failure = new Error("disk full");
  const { database, transactions } = databaseOf(scenarioOf({ failure }));
  await expect(
    new AgentSessionEventRepository(database).appendEvents(
      "a1",
      [newEvent("one")],
      10,
    ),
  ).rejects.toBe(failure);
  expect(transactions()).toBe(1);
});

it("reads events with the first retained sequence", async () => {
  const { database, query } = databaseOf(
    scenarioOf({ eventRows: [[4], [5]], minimum: [4] }),
  );
  const result = await new AgentSessionEventRepository(database).readEvents(
    "a1",
    3,
    10,
  );
  expect(result.events.map((event) => event.sequence)).toEqual([4, 5]);
  expect(result.retainedFrom).toBe(4);
  expect(query.mock.calls[0]?.[1]).toEqual({
    attempt_id: "a1",
    after: 3,
    limit: 10,
  });
});

it("reports no cut for a complete or empty journal", async () => {
  const read = async (
    minimum: DatabaseValue[] | null,
  ): Promise<StoredSessionEvents> =>
    new AgentSessionEventRepository(
      databaseOf(scenarioOf({ minimum })).database,
    ).readEvents("a1", 0, 10);
  expect((await read([1])).retainedFrom).toBeNull();
  expect((await read([null])).retainedFrom).toBeNull();
  expect((await read(null)).retainedFrom).toBeNull();
});

function sequences(page: {
  readonly events: readonly AgentSessionEvent[];
}): number[] {
  return page.events.map((event) => event.sequence);
}

it("prefers the chunk journal for a window", async () => {
  const archived = {
    events: [],
    cursor: null,
    hasMore: false,
    hasEarlier: false,
    retainedFrom: null,
    source: "journal" as const,
  };
  vi.mocked(readSessionHistoryChunks).mockResolvedValue(archived);
  const { database, query } = databaseOf(scenarioOf());
  const repository = new AgentSessionEventRepository(database);
  await expect(
    repository.readWindow("a1", { after: 0, limit: 2 }),
  ).resolves.toBe(archived);
  expect(query).not.toHaveBeenCalled();
});

it("reads a forward window from legacy events", async () => {
  const { database, query } = databaseOf(
    scenarioOf({ eventRows: [[3], [4], [5]], minimum: [3] }),
  );
  const page = await new AgentSessionEventRepository(database).readWindow(
    "a1",
    {
      after: 2,
      limit: 2,
    },
  );
  expect(query.mock.calls[0]?.[1]).toMatchObject({ after: 2, limit: 3 });
  expect(sequences(page)).toEqual([3, 4]);
  expect(page).toMatchObject({
    cursor: 4,
    hasMore: true,
    hasEarlier: false,
    retainedFrom: 3,
    source: "journal",
  });
});

it("reads the newest and earlier legacy windows", async () => {
  const rows = [[1], [2], [3]];
  const read = async (window: {
    before?: number;
    tail?: boolean;
  }): Promise<AgentSessionEventPage> => {
    const { database, query } = databaseOf(
      scenarioOf({ eventRows: rows, minimum: [1] }),
    );
    const page = await new AgentSessionEventRepository(database).readWindow(
      "a1",
      { after: 0, limit: 2, ...window },
    );
    expect(query.mock.calls[0]?.[1]).toMatchObject({ after: 0, limit: 2001 });
    return page;
  };
  const tail = await read({ tail: true });
  expect(sequences(tail)).toEqual([2, 3]);
  expect(tail).toMatchObject({ hasMore: false, hasEarlier: true });
  const before = await read({ before: 3 });
  expect(sequences(before)).toEqual([1, 2]);
  expect(before.hasEarlier).toBe(false);
});

it("keeps the cursor of an empty legacy window", async () => {
  const read = async (after: number): Promise<AgentSessionEventPage> =>
    new AgentSessionEventRepository(
      databaseOf(scenarioOf()).database,
    ).readWindow("a1", { after, limit: 2 });
  expect(await read(0)).toMatchObject({ events: [], cursor: null });
  expect(await read(7)).toMatchObject({ events: [], cursor: 7 });
});
