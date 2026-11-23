import { createHash } from "node:crypto";

import { beforeEach, expect, it, vi } from "vitest";

import {
  appendSessionHistoryChunks,
  prepareSessionHistoryChunks,
  readSessionHistoryChunks,
  type PreparedSessionChunk,
} from "./AgentSessionHistoryChunks";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { AgentSessionEvent } from "@/definition/AgentSessionJournal";

interface SchemaModule {
  readonly agentSessionEventSchema: { parse(value: unknown): unknown };
}

const files = vi.hoisted(() => ({
  write: vi.fn<(planId: string, contents: string) => Promise<string>>(),
  stored: new Map<string, string>(),
}));

vi.mock("@/backend/storage/AgentPayloadFileStore", () => ({
  requireAgentFiles: () => ({ write: files.write }),
  readAgentPayload: async (
    ...[, inline, reference]: [unknown, string, string | null]
  ) => (reference === null ? inline : (files.stored.get(reference) ?? "")),
}));

vi.mock("@/definition/AgentSessionHistory", async (importOriginal) => {
  const original = await importOriginal<SchemaModule>();
  return {
    // Events beyond the public text limit only occur here, to reach the size limits.
    agentSessionEventSchema: {
      parse: (value: unknown) =>
        typeof value === "object" &&
        value !== null &&
        "text" in value &&
        typeof value.text === "string" &&
        value.text.length > 8000
          ? value
          : original.agentSessionEventSchema.parse(value),
    },
  };
});

beforeEach(() => {
  files.stored.clear();
  let counter = 0;
  files.write.mockReset();
  files.write.mockImplementation(async () => `ref-${(counter += 1)}`);
});

function eventOf(
  sequence: number,
  overrides: Partial<AgentSessionEvent> = {},
): AgentSessionEvent {
  return {
    id: `a1:${sequence}`,
    sequence,
    stepId: "s1",
    attemptId: "a1",
    turn: null,
    kind: "status",
    createdAt: "t",
    text: "x",
    isTruncated: false,
    ...overrides,
  };
}

interface ChunkOptions {
  readonly index: number;
  readonly offset?: number;
  readonly previous?: string | null;
  readonly launch?: string;
  readonly first?: number;
  readonly last?: number;
  readonly bytes?: number;
  readonly digest?: string;
  readonly reference?: string;
}

interface BuiltChunk {
  readonly row: DatabaseValue[];
  readonly digest: string;
  readonly end: number;
}

function digestOf(
  fields: readonly [string, string, number, number, number, number],
  previous: string | null,
  contents: string,
): string {
  const [attemptId, launchId, index, offset, first, last] = fields;
  return createHash("sha256")
    .update(
      JSON.stringify([
        attemptId,
        launchId,
        index,
        offset,
        first,
        last,
        previous,
        contents,
      ]),
    )
    .digest("hex");
}

function buildChunk(
  events: readonly AgentSessionEvent[],
  options: ChunkOptions,
): BuiltChunk {
  const contents = events.map((event) => `${JSON.stringify(event)}\n`).join("");
  const launch = options.launch ?? "l1";
  const offset = options.offset ?? 0;
  const previous = options.previous ?? null;
  const first = options.first ?? events[0]?.sequence ?? 0;
  const last = options.last ?? events.at(-1)?.sequence ?? 0;
  const bytes = options.bytes ?? Buffer.byteLength(contents);
  const digest =
    options.digest ??
    digestOf(
      ["a1", launch, options.index, offset, first, last],
      previous,
      contents,
    );
  if (options.reference) files.stored.set(options.reference, contents);
  return {
    row: [
      launch,
      options.index,
      offset,
      bytes,
      first,
      last,
      digest,
      previous,
      options.reference ? "" : contents,
      options.reference ?? null,
    ],
    digest,
    end: offset + bytes,
  };
}

interface Tables {
  bounds?: DatabaseValue[];
  prefix?: DatabaseValue[][];
  chunks?: DatabaseValue[][];
  link?: DatabaseValue[];
  latest?: DatabaseValue[];
}

function transactionOf(tables: Tables = {}): {
  readonly transaction: DatabaseTransaction;
  readonly execute: ReturnType<typeof vi.fn<DatabaseTransaction["execute"]>>;
  readonly query: ReturnType<typeof vi.fn<DatabaseTransaction["query"]>>;
} {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  const query = vi.fn<DatabaseTransaction["query"]>(async (statement) => {
    if (statement.includes("MIN(first_sequence)"))
      return tables.bounds ? [tables.bounds] : [];
    if (statement.includes("FROM agent_session_events"))
      return tables.prefix ?? [];
    if (statement.includes("$chunk_limit")) return tables.chunks ?? [];
    if (statement.includes("$chunk_index"))
      return tables.link ? [tables.link] : [];
    return tables.latest ? [tables.latest] : [];
  });
  return { transaction: { execute, query }, execute, query };
}

function linkOf(
  chunk: BuiltChunk,
  last: number,
  launch = "l1",
): DatabaseValue[] {
  return [chunk.digest, chunk.end, last, launch];
}

function prefixRow(sequence: number): DatabaseValue[] {
  return [sequence, null, "status", "legacy", 0, "t", "s1", null];
}

it("splits large events into several files", async () => {
  const { transaction } = transactionOf();
  const big = "y".repeat(3_000_000);
  const chunks = await prepareSessionHistoryChunks(transaction, "p1", [
    eventOf(1, { text: big }),
    eventOf(2, { text: big }),
    eventOf(3),
  ]);
  expect(
    chunks.map(({ first, last, reference }) => [first, last, reference]),
  ).toEqual([
    [1, 1, "ref-1"],
    [2, 3, "ref-2"],
  ]);
  expect(files.write).toHaveBeenCalledWith("p1", chunks[1]?.contents);
});

it("keeps small events in one file and none for no events", async () => {
  const { transaction } = transactionOf();
  const chunks = await prepareSessionHistoryChunks(transaction, "p1", [
    eventOf(5),
    eventOf(6),
  ]);
  expect(chunks).toHaveLength(1);
  expect(chunks[0]).toMatchObject({ first: 5, last: 6 });
  await expect(
    prepareSessionHistoryChunks(transaction, "p1", []),
  ).resolves.toEqual([]);
});

it("rejects a single event beyond the chunk size", async () => {
  const { transaction } = transactionOf();
  await expect(
    prepareSessionHistoryChunks(transaction, "p1", [
      eventOf(1, { text: "y".repeat(4_194_400) }),
    ]),
  ).rejects.toThrow("Session history event too large");
});

function preparedOf(
  first: number,
  last: number,
  bytes = 10,
): PreparedSessionChunk {
  return { contents: "c", reference: `file-${first}`, bytes, first, last };
}

const OWNER = { attemptId: "a1", launchId: "l1" };

it("appends nothing for no events", async () => {
  const { transaction, query } = transactionOf();
  await appendSessionHistoryChunks(transaction, OWNER, []);
  expect(query).not.toHaveBeenCalled();
});

it("requires prepared chunks that match the events", async () => {
  const { transaction } = transactionOf();
  const events = [eventOf(1), eventOf(2)];
  const message =
    "Session history must be synchronized before its transaction.";
  await expect(
    appendSessionHistoryChunks(transaction, OWNER, events),
  ).rejects.toThrow(message);
  await expect(
    appendSessionHistoryChunks(transaction, OWNER, events, [preparedOf(2, 2)]),
  ).rejects.toThrow(message);
  await expect(
    appendSessionHistoryChunks(transaction, OWNER, events, [preparedOf(1, 1)]),
  ).rejects.toThrow(message);
});

it("starts the chain of an attempt and links the chunks", async () => {
  const { transaction, execute } = transactionOf();
  await appendSessionHistoryChunks(
    transaction,
    OWNER,
    [eventOf(1), eventOf(2), eventOf(3)],
    [preparedOf(1, 2, 20), preparedOf(3, 3, 7)],
  );
  const first = execute.mock.calls[0]?.[1];
  const second = execute.mock.calls[1]?.[1];
  const firstDigest = digestOf(["a1", "l1", 1, 0, 1, 2], null, "c");
  expect(first).toMatchObject({
    chunk_index: 1,
    byte_offset: 0,
    byte_length: 20,
    sha256: firstDigest,
    previous_sha256: null,
    events_jsonl: "",
    events_file: "file-1",
  });
  expect(second).toMatchObject({
    chunk_index: 2,
    byte_offset: 20,
    previous_sha256: firstDigest,
    first_sequence: 3,
  });
});

it("continues the chain after the stored chunk", async () => {
  const stored = buildChunk([eventOf(1), eventOf(2)], {
    index: 4,
    offset: 100,
  });
  const { transaction, execute } = transactionOf({ latest: stored.row });
  await appendSessionHistoryChunks(
    transaction,
    OWNER,
    [eventOf(3)],
    [preparedOf(3, 3)],
  );
  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    chunk_index: 5,
    byte_offset: stored.end,
    previous_sha256: stored.digest,
  });
});

it("rejects a changed launch, a gap and a missing file", async () => {
  const stored = buildChunk([eventOf(1)], { index: 1, launch: "other" });
  const events = [eventOf(2)];
  await expect(
    appendSessionHistoryChunks(
      transactionOf({ latest: stored.row }).transaction,
      OWNER,
      events,
      [preparedOf(2, 2)],
    ),
  ).rejects.toThrow("Session history launch changed");
  const own = buildChunk([eventOf(1)], { index: 1 });
  await expect(
    appendSessionHistoryChunks(
      transactionOf({ latest: own.row }).transaction,
      OWNER,
      [eventOf(3)],
      [preparedOf(3, 3)],
    ),
  ).rejects.toThrow("Session history event out of sequence");
  await expect(
    appendSessionHistoryChunks(transactionOf().transaction, OWNER, events, [
      { ...preparedOf(2, 2), reference: "" },
    ]),
  ).rejects.toThrow("Prepared history file missing.");
});

it("tolerates a hollow event list while reading the chain start", async () => {
  const hollowEvents = new Array<AgentSessionEvent>(1);
  const hollowChunks = new Array<PreparedSessionChunk>(1);
  await expect(
    appendSessionHistoryChunks(
      transactionOf().transaction,
      OWNER,
      hollowEvents,
      hollowChunks,
    ),
  ).rejects.toThrow(TypeError);
});

const FORWARD = { after: 0, limit: 2 };

function twoChunks(): readonly [BuiltChunk, BuiltChunk] {
  const first = buildChunk([eventOf(1), eventOf(2)], { index: 1 });
  const second = buildChunk([eventOf(3), eventOf(4)], {
    index: 2,
    offset: first.end,
    previous: first.digest,
  });
  return [first, second];
}

it("has no window without stored chunks", async () => {
  await expect(
    readSessionHistoryChunks(transactionOf().transaction, "a1", FORWARD),
  ).resolves.toBeNull();
  await expect(
    readSessionHistoryChunks(
      transactionOf({ bounds: [null, null] }).transaction,
      "a1",
      FORWARD,
    ),
  ).resolves.toBeNull();
});

it("reads the first page forward", async () => {
  const [first, second] = twoChunks();
  const { transaction } = transactionOf({
    bounds: [1, 4],
    chunks: [first.row, second.row],
  });
  const page = await readSessionHistoryChunks(transaction, "a1", FORWARD);
  expect(page).toEqual({
    events: [eventOf(1), eventOf(2)],
    cursor: 2,
    hasMore: true,
    hasEarlier: false,
    retainedFrom: null,
    source: "journal",
  });
});

it("reads on across a chunk link until the limit or the end", async () => {
  const [first, second] = twoChunks();
  const { transaction } = transactionOf({
    bounds: [1, 4],
    chunks: [first.row, second.row],
    link: linkOf(first, 2),
  });
  const page = await readSessionHistoryChunks(transaction, "a1", {
    after: 0,
    limit: 3,
  });
  expect(page?.events.map((event) => event.sequence)).toEqual([1, 2, 3]);
  const all = await readSessionHistoryChunks(transaction, "a1", {
    after: 0,
    limit: 10,
  });
  expect(all).toMatchObject({ cursor: 4, hasMore: false });
});

it("reads the newest page and earlier pages backward", async () => {
  const [first, second] = twoChunks();
  const { transaction } = transactionOf({
    bounds: [1, 4],
    chunks: [second.row, first.row],
    link: linkOf(first, 2),
  });
  const tail = await readSessionHistoryChunks(transaction, "a1", {
    after: 0,
    tail: true,
    limit: 2,
  });
  expect(tail).toMatchObject({ cursor: 4, hasMore: false, hasEarlier: true });
  expect(tail?.events.map((event) => event.sequence)).toEqual([3, 4]);
  const before = await readSessionHistoryChunks(transaction, "a1", {
    after: 0,
    before: 4,
    limit: 2,
  });
  expect(before?.events.map((event) => event.sequence)).toEqual([2, 3]);
});

it("returns an empty page behind the last event", async () => {
  const { transaction } = transactionOf({ bounds: [1, 4], chunks: [] });
  const page = await readSessionHistoryChunks(transaction, "a1", {
    after: 4,
    limit: 2,
  });
  expect(page).toMatchObject({ events: [], cursor: 4, hasMore: false });
  const empty = await readSessionHistoryChunks(transaction, "a1", FORWARD);
  expect(empty).toMatchObject({ events: [], cursor: null, hasMore: true });
});

it("rejects windows beyond the stored history", async () => {
  const { transaction } = transactionOf({ bounds: [1, 4], chunks: [] });
  await expect(
    readSessionHistoryChunks(transaction, "a1", { after: 5, limit: 2 }),
  ).rejects.toMatchObject({ code: "plan_invalid" });
  await expect(
    readSessionHistoryChunks(transaction, "a1", {
      after: 0,
      before: 6,
      limit: 2,
    }),
  ).rejects.toMatchObject({ code: "plan_invalid" });
});

it("joins retained legacy events before the first chunk", async () => {
  const chunk = buildChunk([eventOf(3), eventOf(4)], { index: 1 });
  const { transaction } = transactionOf({
    bounds: [3, 4],
    prefix: [prefixRow(1), prefixRow(2)],
    chunks: [chunk.row],
  });
  const forward = await readSessionHistoryChunks(transaction, "a1", {
    after: 0,
    limit: 3,
  });
  expect(forward?.events.map((event) => event.sequence)).toEqual([1, 2, 3]);
  expect(forward).toMatchObject({ hasEarlier: false, retainedFrom: null });
  const backward = await readSessionHistoryChunks(transaction, "a1", {
    after: 0,
    tail: true,
    limit: 3,
  });
  expect(backward?.events.map((event) => event.sequence)).toEqual([2, 3, 4]);
});

it("reports the cut where no legacy events remain", async () => {
  const chunk = buildChunk([eventOf(3), eventOf(4)], { index: 1 });
  const { transaction } = transactionOf({
    bounds: [3, 4],
    chunks: [chunk.row],
  });
  const page = await readSessionHistoryChunks(transaction, "a1", {
    after: 0,
    limit: 5,
  });
  expect(page).toMatchObject({ retainedFrom: 3, hasEarlier: false });
});

it("reads a chunk stored in a file", async () => {
  const chunk = buildChunk([eventOf(1)], { index: 1, reference: "ref-x" });
  const { transaction } = transactionOf({
    bounds: [1, 1],
    chunks: [chunk.row],
  });
  const page = await readSessionHistoryChunks(transaction, "a1", FORWARD);
  expect(page?.events).toEqual([eventOf(1)]);
});

async function readCorrupt(
  options: ChunkOptions,
  events: readonly AgentSessionEvent[] = [eventOf(1)],
  link?: DatabaseValue[],
): Promise<unknown> {
  const chunk = buildChunk(events, options);
  const { transaction } = transactionOf({
    bounds: [1, 9],
    chunks: [chunk.row],
    link,
  });
  return readSessionHistoryChunks(transaction, "a1", FORWARD).catch(
    (error: unknown) => error,
  );
}

it("rejects a chunk that does not match its record", async () => {
  const corrupt = { code: "plan_history_corrupt" };
  expect(await readCorrupt({ index: 1, bytes: 5_000_000 })).toMatchObject(
    corrupt,
  );
  expect(await readCorrupt({ index: 1, bytes: 3 })).toMatchObject(corrupt);
  expect(await readCorrupt({ index: 1, digest: "0".repeat(64) })).toMatchObject(
    corrupt,
  );
});

it("rejects chunk contents that break the sequence", async () => {
  const corrupt = { code: "plan_history_corrupt" };
  expect(
    await readCorrupt({ index: 1 }, [eventOf(1, { attemptId: "other" })]),
  ).toMatchObject(corrupt);
  expect(await readCorrupt({ index: 1, first: 2 }, [eventOf(1)])).toMatchObject(
    corrupt,
  );
  expect(await readCorrupt({ index: 1, last: 5 }, [eventOf(1)])).toMatchObject(
    corrupt,
  );
});

it("rejects a broken start of the chain", async () => {
  const corrupt = { code: "plan_history_corrupt" };
  expect(await readCorrupt({ index: 1, previous: "abc" })).toMatchObject(
    corrupt,
  );
  expect(await readCorrupt({ index: 1, offset: 4 })).toMatchObject(corrupt);
});

it("rejects a chunk that does not follow its predecessor", async () => {
  const corrupt = { code: "plan_history_corrupt" };
  const options = { index: 2, previous: "p", offset: 10 };
  const events = [eventOf(3)];
  const good = ["p", 10, 2, "l1"];
  expect(await readCorrupt(options, events)).toMatchObject(corrupt);
  expect(await readCorrupt(options, events, ["x", 10, 2, "l1"])).toMatchObject(
    corrupt,
  );
  expect(await readCorrupt(options, events, ["p", 9, 2, "l1"])).toMatchObject(
    corrupt,
  );
  expect(await readCorrupt(options, events, ["p", 10, 1, "l1"])).toMatchObject(
    corrupt,
  );
  expect(await readCorrupt(options, events, ["p", 10, 2, "l2"])).toMatchObject(
    corrupt,
  );
  expect(await readCorrupt(options, events, good)).toMatchObject({
    source: "journal",
  });
});
