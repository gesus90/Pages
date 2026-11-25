import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findEntries: vi.fn(async () => [] as unknown[]),
  save: vi.fn(async () => undefined),
  saveTurnUsage: vi.fn(async () => undefined),
  account: vi.fn<Call>(async () => undefined),
  reading: vi.fn(async () => undefined),
  saveOpenCode: vi.fn<Call>(async () => undefined),
  openCodeDatabase: vi.fn<(database: unknown) => void>(),
}));
vi.mock("../agent/OpenCodeUsageRepository", () => ({
  OpenCodeUsageRepository: class {
    public readonly save = mocks.saveOpenCode;

    public constructor(database: unknown) {
      mocks.openCodeDatabase(database);
    }
  },
}));
vi.mock("../agent/AgentPlanAgentTodoRepository", () => ({
  AgentPlanAgentTodoRepository: class {
    public readonly findEntries = mocks.findEntries;
    public readonly save = mocks.save;
  },
}));
vi.mock("../agent/AgentSessionRepository", () => ({
  AgentSessionRepository: class {
    public readonly saveTurnUsage = mocks.saveTurnUsage;
  },
}));
vi.mock("@/backend/service/agents/sessions/ClaudeUsageAccounting", () => ({
  accountClaudeUsage: mocks.account,
}));
vi.mock("./RunnerSessionReadings", () => ({
  persistRunnerSessionReading: mocks.reading,
}));

import { persistRunnerStructuredProgress } from "./RunnerStructuredProgress";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { RunnerLiveEvent } from "@/definition/RunnerLiveHistory";

type Call = (...parameters: unknown[]) => Promise<undefined>;

type Read = (...parameters: unknown[]) => Promise<unknown[][]>;

const AT = "2026-05-01T00:00:00.000Z";
const USAGE = JSON.stringify({
  inputTokens: 10,
  outputTokens: 5,
  cacheReadTokens: 0,
});

function eventOf(kind: string, text: string): RunnerLiveEvent {
  return {
    sequence: 1,
    kind,
    text,
    isTruncated: false,
    createdAt: AT,
  } as unknown as RunnerLiveEvent;
}

function transactionOf(attempt: unknown[][]): DatabaseTransaction {
  return {
    query: vi.fn<Read>(async () => attempt),
  } as unknown as DatabaseTransaction;
}

function progress(
  transaction: DatabaseTransaction,
  event: RunnerLiveEvent,
  extra: { hasTerminalUsage?: boolean; turn?: number } = {},
): Promise<void> {
  return persistRunnerStructuredProgress(transaction, {
    attemptId: "a1",
    event,
    hasTerminalUsage: extra.hasTerminalUsage ?? false,
    ...(extra.turn === undefined ? {} : { turn: extra.turn }),
  });
}

beforeEach(() => vi.clearAllMocks());

describe("session readings", () => {
  const reading = JSON.stringify({ session: { model: "m", context: null } });

  it("stores a valid reading and no token counters", async () => {
    await progress(transactionOf([]), eventOf("usage", reading));

    expect(mocks.reading).toHaveBeenCalledWith(expect.anything(), {
      attemptId: "a1",
      reading: { model: "m", context: null },
      reportedAt: AT,
    });
    expect(mocks.saveTurnUsage).not.toHaveBeenCalled();
  });

  it("drops a reading that breaks the contract", async () => {
    await progress(
      transactionOf([]),
      eventOf("usage", JSON.stringify({ session: { model: "bad model" } })),
    );

    expect(mocks.reading).not.toHaveBeenCalled();
    expect(mocks.saveTurnUsage).not.toHaveBeenCalled();
  });
});

describe("plan events", () => {
  it("merges the entries with the stored list", async () => {
    mocks.findEntries.mockResolvedValueOnce([]);
    const text = JSON.stringify({
      entries: [{ content: "do", status: "pending" }],
    });

    await progress(transactionOf([]), eventOf("plan", text));

    expect(mocks.save).toHaveBeenCalledWith(
      "a1",
      [expect.objectContaining({ text: "do" })],
      AT,
    );
  });

  it("ignores a plan text without entries", async () => {
    await progress(transactionOf([]), eventOf("plan", "nope"));

    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("ignores other event kinds", async () => {
    await progress(transactionOf([]), eventOf("output", "x"));

    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.saveTurnUsage).not.toHaveBeenCalled();
  });
});

it("leaves usage to the terminal result when it reported one", async () => {
  await progress(transactionOf([]), eventOf("usage", USAGE), {
    hasTerminalUsage: true,
  });

  expect(mocks.saveTurnUsage).not.toHaveBeenCalled();
});

it.each([
  { name: "an unknown attempt", rows: [] },
  {
    name: "an unknown provider",
    rows: [["bogus", "m", "running", null, null]],
  },
  {
    name: "a provider without ACP",
    rows: [["openai", "m", "running", null, null]],
  },
])("ignores $name", async ({ rows }) => {
  await progress(transactionOf(rows), eventOf("usage", USAGE));

  expect(mocks.saveTurnUsage).not.toHaveBeenCalled();
  expect(mocks.account).not.toHaveBeenCalled();
});

it("ignores a reading without any value", async () => {
  await progress(
    transactionOf([["opencode", "m", "running", null, null]]),
    eventOf(
      "usage",
      JSON.stringify({
        inputTokens: null,
        outputTokens: null,
        cacheReadTokens: null,
      }),
    ),
  );

  expect(mocks.saveTurnUsage).not.toHaveBeenCalled();
});

it("saves usage of a Codex attempt with its connection", async () => {
  await progress(
    transactionOf([["codex_cli", "gpt", "running", "c1", "g1"]]),
    eventOf("usage", USAGE),
    { turn: 4 },
  );

  expect(mocks.saveTurnUsage).toHaveBeenCalledWith(
    expect.objectContaining({
      attemptId: "a1",
      turn: 4,
      provider: "codex_cli",
      model: "gpt",
      reportedAt: AT,
      codex: { connectionId: "c1", agentId: "g1", report: null },
    }),
  );
});

it("defaults the Codex identity and the turn", async () => {
  await progress(
    transactionOf([["codex_cli", null, "running", null, null]]),
    eventOf("usage", USAGE),
  );

  expect(mocks.saveTurnUsage).toHaveBeenCalledWith(
    expect.objectContaining({
      turn: 1,
      model: null,
      codex: { connectionId: "", agentId: "", report: null },
    }),
  );
});

it("passes the Claude observation to the accounting", async () => {
  const observation = {
    sessionId: "s",
    id: "o1",
    kind: "message",
    models: [],
  };
  const text = JSON.stringify({
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 0,
    claudeObservation: observation,
  });

  await progress(
    transactionOf([["claude_code", "m", "running", null, null]]),
    eventOf("usage", text),
  );

  expect(mocks.account).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ claudeObservation: observation }),
  );
});

it("accounts Claude usage through its accounting", async () => {
  const transaction = transactionOf([
    ["claude_code", "m", "running", null, null],
  ]);

  await progress(transaction, eventOf("usage", USAGE));

  expect(mocks.account).toHaveBeenCalledTimes(1);
  const database = mocks.account.mock.calls[0]?.[0] as {
    transaction: (
      work: (access: DatabaseTransaction) => Promise<string>,
    ) => Promise<string>;
  };
  expect(
    await database.transaction(async (access) =>
      String(access === transaction),
    ),
  ).toBe("true");
});

it("maps OpenRouter onto the OpenCode counters", async () => {
  await progress(
    transactionOf([["openrouter", "m", "running", null, null]]),
    eventOf("usage", USAGE),
  );

  expect(mocks.saveTurnUsage).toHaveBeenCalledWith(
    expect.objectContaining({ provider: "openrouter" }),
  );
});

it("totals a Claude observation a runner before the ledger sent as a message", async () => {
  const text = JSON.stringify({
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 0,
    isInterim: true,
    claudeObservation: {
      sessionId: "s",
      id: "runner:1",
      kind: "message",
      models: [],
    },
  });

  await progress(
    transactionOf([["claude_code", "m", "running", null, null]]),
    eventOf("usage", text),
  );

  expect(mocks.account).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      isPartial: true,
      claudeObservation: {
        sessionId: "s",
        id: "runner:1",
        kind: "total",
        models: [],
      },
    }),
  );
});

describe("OpenCode model steps", () => {
  const message = {
    id: "m1",
    sessionId: "s1",
    model: "p/m",
    inputTokens: 10,
    outputTokens: 5,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: null,
    costUsd: 0.5,
  };
  const text = JSON.stringify({ openCodeMessage: message });

  it("drops a step that breaks the contract", async () => {
    const transaction = transactionOf([]);

    await progress(
      transaction,
      eventOf("usage", JSON.stringify({ openCodeMessage: { id: "" } })),
    );

    expect(transaction.query).not.toHaveBeenCalled();
    expect(mocks.saveOpenCode).not.toHaveBeenCalled();
  });

  it("ignores a step of an unknown attempt", async () => {
    await progress(transactionOf([]), eventOf("usage", text));

    expect(mocks.saveOpenCode).not.toHaveBeenCalled();
    expect(mocks.saveTurnUsage).not.toHaveBeenCalled();
  });

  it("ignores a step of another provider", async () => {
    await progress(
      transactionOf([["claude_code", null]]),
      eventOf("usage", text),
    );

    expect(mocks.saveOpenCode).not.toHaveBeenCalled();
  });

  it("leaves a step another attempt owns as it is", async () => {
    await progress(transactionOf([["opencode", "a2"]]), eventOf("usage", text));

    expect(mocks.saveOpenCode).not.toHaveBeenCalled();
  });

  it.each([
    { provider: "opencode", owner: null, turn: undefined, expected: 1 },
    { provider: "openrouter", owner: "a1", turn: 3, expected: 3 },
  ])(
    "stores a step of $provider",
    async ({ provider, owner, turn, expected }) => {
      const transaction = transactionOf([[provider, owner]]);

      await progress(
        transaction,
        eventOf("usage", text),
        turn === undefined ? {} : { turn },
      );

      expect(mocks.saveOpenCode).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "m1",
          attemptId: "a1",
          turn: expected,
          reportedAt: AT,
        }),
      );
      expect(mocks.saveTurnUsage).not.toHaveBeenCalled();
      const database = mocks.openCodeDatabase.mock.calls[0]?.[0] as {
        transaction: (
          work: (access: DatabaseTransaction) => Promise<boolean>,
        ) => Promise<boolean>;
      };
      expect(
        await database.transaction(async (access) => access === transaction),
      ).toBe(true);
    },
  );
});
