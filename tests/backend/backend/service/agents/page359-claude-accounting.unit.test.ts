import { beforeEach, expect, it, vi } from "vitest";

import { accountClaudeUsage } from "@/backend/service/agents/sessions/ClaudeUsageAccounting";
import { readClaudeSdkUsage } from "@/backend/agents/acp/ClaudeAcpUsage";
import { summarizeClaudeUsage } from "@/definition/ClaudeUsageSummary";

import type { AgentSessionTurnUsage } from "@/definition/AgentSessionJournal";
import type {
  ClaudeLedger,
  ClaudePrice,
  ClaudeUsageObservation,
} from "@/definition/ClaudeUsage";
import type { AgentSessionDatabase } from "@/backend/database/repositories/agent/AgentSessionDatabase";

interface AccountingState {
  readonly ledger: Map<string, ClaudeLedger>;
  readonly usage: Map<string, AgentSessionTurnUsage>;
  prices: ClaudePrice[];
  overrides: Record<string, string>;
  writes: number;
}
const state = vi.hoisted((): AccountingState => ({
  ledger: new Map(),
  usage: new Map(),
  prices: [],
  overrides: {},
  writes: 0,
}));
vi.mock("@/backend/database/repositories/agent/ClaudeUsageRepository", () => ({
  ClaudeUsageRepository: class {
    public async lock(id: string): Promise<ClaudeLedger> {
      return state.ledger.get(id) ?? { settled: [], messages: {}, seen: [] };
    }
    public async save(id: string, ledger: ClaudeLedger): Promise<void> {
      state.ledger.set(id, ledger);
    }
    public async modelOverrides(): Promise<Readonly<Record<string, string>>> {
      return state.overrides;
    }
  },
}));
vi.mock(
  "@/backend/database/repositories/agent/OpenRouterPriceRepository",
  () => ({
    OpenRouterPriceRepository: class {
      public async read(): Promise<{ fetchedAt: string; catalog: string }> {
        return {
          fetchedAt: "2026-11-13",
          catalog: JSON.stringify(state.prices),
        };
      }
    },
  }),
);
vi.mock("@/backend/database/repositories/agent/AgentSessionRepository", () => ({
  AgentSessionRepository: class {
    public async findTurnUsage(
      id: string,
      turn: number,
    ): Promise<AgentSessionTurnUsage | null> {
      return state.usage.get(`${id}:${turn}`) ?? null;
    }
    public async listAttemptUsage(
      id: string,
    ): Promise<readonly AgentSessionTurnUsage[]> {
      return [...state.usage.values()].filter(
        (usage) => usage.attemptId === id,
      );
    }
    public async saveTurnUsage(usage: AgentSessionTurnUsage): Promise<void> {
      state.writes += 1;
      state.usage.set(`${usage.attemptId}:${usage.turn}`, usage);
    }
  },
}));
const database: AgentSessionDatabase = {
  query: async () => [],
  execute: async () => undefined,
  transaction: async (work) => work(database),
};
const MODEL = "claude-haiku-5-5";
const PRICE: ClaudePrice = {
  modelId: "anthropic/claude-haiku-5.5",
  fetchedAt: "2026-11-13T00:00:00Z",
  prompt: "0.000001",
  completion: "0.000005",
  cacheRead: "0.0000001",
  cacheWrite: "0.00000125",
};

beforeEach(() => {
  state.ledger.clear();
  state.usage.clear();
  state.prices = [PRICE];
  state.overrides = {};
  state.writes = 0;
});

function observation(
  id: string,
  input: number,
  output: number,
  kind: ClaudeUsageObservation["kind"] = "total",
): ClaudeUsageObservation {
  return {
    sessionId: "native-session",
    id,
    kind,
    models: [
      {
        model: MODEL,
        inputTokens: input,
        outputTokens: output,
        cacheReadTokens: input * 10,
        cacheWriteTokens: input * 2,
      },
    ],
  };
}
function turn(
  attemptId: string,
  native?: ClaudeUsageObservation,
  number = 1,
): AgentSessionTurnUsage {
  return {
    attemptId,
    turn: number,
    provider: "claude_code",
    model: MODEL,
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    totalTokens: null,
    inputIncludesCache: false,
    isPartial: true,
    reportedAt: "2026-11-13T10:00:00Z",
    ...(native ? { claudeObservation: native } : {}),
  };
}

it("projects only native accounting fields and uses complete modelUsage including subagents", () => {
  const projected = readClaudeSdkUsage({
    sessionId: "native-session",
    message: {
      type: "result",
      uuid: "r1",
      result: "private conversation content",
      usage: { input_tokens: 1 },
      modelUsage: {
        [MODEL]: {
          inputTokens: 100,
          outputTokens: 20,
          cacheReadInputTokens: 1000,
          cacheCreationInputTokens: 200,
        },
        "claude-sonnet-5": { inputTokens: 50, outputTokens: 10 },
      },
    },
  });
  expect(projected?.models[0]?.inputTokens).toBe(100);
  expect(projected?.models[1]?.cacheReadTokens).toBeNull();
  expect(JSON.stringify(projected)).not.toContain("private conversation");
  expect(
    readClaudeSdkUsage({
      sessionId: "s",
      message: {
        type: "assistant",
        message: { id: "m", model: MODEL, usage: { input_tokens: -1 } },
      },
    }),
  ).toBeNull();
});

it("replaces live assistant readings and reconciles their counts with a cumulative result exactly once", async () => {
  await accountClaudeUsage(
    database,
    turn("a", observation("m1", 100, 10, "message")),
  );
  expect(state.usage.get("a:1")?.totalTokens).toBe(1310);
  await accountClaudeUsage(
    database,
    turn("a", observation("m1", 100, 20, "message")),
  );
  expect(state.usage.get("a:1")?.outputTokens).toBe(20);
  await accountClaudeUsage(
    database,
    turn("a", observation("m2", 200, 30, "message")),
  );
  expect(state.usage.get("a:1")?.inputTokens).toBe(300);
  const result = observation("r1", 350, 60);
  await accountClaudeUsage(database, turn("a", result));
  expect(state.usage.get("a:1")).toMatchObject({
    inputTokens: 350,
    outputTokens: 60,
    cacheReadTokens: 3500,
    cacheWriteTokens: 700,
    totalTokens: 4610,
  });
  const writes = state.writes;
  await accountClaudeUsage(database, turn("a", result));
  await accountClaudeUsage(
    database,
    turn("a", observation("m1", 100, 20, "message")),
  );
  expect(state.writes).toBe(writes);
});

it("counts only increments on later turns, retries and a resumed native session in another run", async () => {
  await accountClaudeUsage(
    database,
    turn("first-run", observation("r1", 100, 10)),
  );
  await accountClaudeUsage(
    database,
    turn("first-run", observation("r2", 250, 30), 2),
  );
  await accountClaudeUsage(
    database,
    turn("resumed-run", observation("r2", 250, 30)),
  );
  await accountClaudeUsage(
    database,
    turn("resumed-run", observation("r3", 400, 60)),
  );
  expect(state.usage.get("first-run:2")?.inputTokens).toBe(150);
  expect(state.usage.get("resumed-run:1")?.inputTokens).toBe(150);
  expect(summarizeClaudeUsage([...state.usage.values()]).inputTokens).toBe(400);
  expect(summarizeClaudeUsage([...state.usage.values()]).outputTokens).toBe(60);
});

it("prices all four token categories from frozen OpenRouter rates across turns and keeps subscription accounting", async () => {
  await accountClaudeUsage(database, turn("a", observation("r1", 100, 20)));
  const first = state.usage.get("a:1");
  expect(first?.claudeAccounting?.subscription).toBe(true);
  expect(first?.claudeAccounting?.costUsd).toBeCloseTo(0.00055, 10);
  state.prices = [
    { ...PRICE, prompt: "99", fetchedAt: "2026-11-14T00:00:00Z" },
  ];
  await accountClaudeUsage(database, turn("a", observation("r2", 200, 40), 2));
  expect(state.usage.get("a:2")?.claudeAccounting?.models[0]?.price).toEqual(
    PRICE,
  );
  expect(state.usage.get("a:2")?.claudeAccounting?.costUsd).toBeCloseTo(
    0.00055,
    10,
  );
  expect(first).toEqual(state.usage.get("a:1"));
});

it("preserves unknown prices and absent usage instead of recording a free step", async () => {
  state.prices = [];
  await accountClaudeUsage(database, turn("a", observation("r1", 100, 20)));
  expect(state.usage.get("a:1")?.claudeAccounting?.costUsd).toBeNull();
  expect(summarizeClaudeUsage([...state.usage.values()])).toMatchObject({
    hasUnknownPrice: true,
    costUsd: null,
  });
  await accountClaudeUsage(database, turn("missing"));
  const missing = state.usage.get("missing:1");
  expect(missing?.totalTokens).toBeNull();
  expect(missing?.claudeAccounting?.costUsd).toBeNull();
  expect(summarizeClaudeUsage([...state.usage.values()]).isIncomplete).toBe(
    true,
  );
});

it("uses an administrator's explicit model mapping and does not overwrite native counts with the flat prompt response", async () => {
  state.prices = [{ ...PRICE, modelId: "anthropic/custom-haiku" }];
  state.overrides = { [MODEL]: "anthropic/custom-haiku" };
  await accountClaudeUsage(database, turn("a", observation("r1", 100, 20)));
  await accountClaudeUsage(database, {
    ...turn("a"),
    inputTokens: 1,
    outputTokens: 1,
    totalTokens: 2,
  });
  expect(state.usage.get("a:1")?.inputTokens).toBe(100);
  expect(
    state.usage.get("a:1")?.claudeAccounting?.models[0]?.price?.modelId,
  ).toBe("anthropic/custom-haiku");
});

it("distinguishes a genuinely reported zero from a session with no usage fields", async () => {
  expect(
    readClaudeSdkUsage({
      sessionId: "s",
      message: {
        type: "assistant",
        message: { id: "m", model: MODEL, usage: {} },
      },
    }),
  ).toBeNull();
  await accountClaudeUsage(database, turn("zero", observation("r1", 0, 0)));
  expect(state.usage.get("zero:1")).toMatchObject({
    totalTokens: 0,
    claudeAccounting: { costUsd: 0, subscription: true },
  });
});

it("includes subagents once at their own prices and does not charge an earlier model to a later step", async () => {
  const submodel = "claude-sonnet-5";
  state.prices.push({
    ...PRICE,
    modelId: "anthropic/claude-sonnet-5",
    prompt: "0.000002",
    completion: "0.00001",
    cacheRead: "0.0000002",
    cacheWrite: "0.0000025",
  });
  const main = observation("r1", 100, 20);
  const sub = {
    model: submodel,
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 100,
    cacheWriteTokens: 20,
  };
  await accountClaudeUsage(
    database,
    turn("first", observation("m1", 100, 20, "message")),
  );
  await accountClaudeUsage(
    database,
    turn("first", {
      ...main,
      id: "sub-message",
      kind: "message",
      models: [sub],
    }),
  );
  await accountClaudeUsage(
    database,
    turn("first", { ...main, models: [...main.models, sub] }),
  );
  expect(state.usage.get("first:1")).toMatchObject({
    inputTokens: 110,
    outputTokens: 25,
    cacheReadTokens: 1100,
    cacheWriteTokens: 220,
  });
  expect(state.usage.get("first:1")?.claudeAccounting?.costUsd).toBeCloseTo(
    0.00069,
    10,
  );
  state.prices = [PRICE];
  const second = observation("r2", 200, 40);
  await accountClaudeUsage(
    database,
    turn("second", { ...second, models: [...second.models, sub] }),
  );
  expect(state.usage.get("second:1")?.claudeAccounting?.models).toHaveLength(1);
  expect(state.usage.get("second:1")?.claudeAccounting?.costUsd).toBeCloseTo(
    0.00055,
    10,
  );
});

it("merges equivalent dated and context model spellings without dropping their usage", () => {
  const reported = readClaudeSdkUsage({
    sessionId: "native",
    message: {
      type: "result",
      uuid: "result",
      modelUsage: {
        "claude-haiku-5-5": { inputTokens: 100, outputTokens: 10 },
        "claude-haiku-5-5-20261113[1m]": { inputTokens: 200, outputTokens: 20 },
      },
    },
  });
  expect(reported?.models).toEqual([
    {
      model: MODEL,
      inputTokens: 300,
      outputTokens: 30,
      cacheReadTokens: null,
      cacheWriteTokens: null,
    },
  ]);
});

it("seeds the native watermark from a prompt-only report so later full session totals do not repeat it", async () => {
  await accountClaudeUsage(
    database,
    turn("a", observation("fallback", 100, 10, "prompt")),
  );
  await accountClaudeUsage(database, turn("a", observation("r2", 250, 30), 2));
  expect(state.usage.get("a:2")?.inputTokens).toBe(150);
  expect(summarizeClaudeUsage([...state.usage.values()]).inputTokens).toBe(250);
});

it("marks incomplete model readings even when another model supplies every token category", async () => {
  const complete = observation("r1", 100, 20);
  await accountClaudeUsage(
    database,
    turn("partial", {
      ...complete,
      models: [
        ...complete.models,
        {
          model: "claude-sonnet-5",
          inputTokens: null,
          outputTokens: 5,
          cacheReadTokens: null,
          cacheWriteTokens: null,
        },
      ],
    }),
  );
  const summary = summarizeClaudeUsage([...state.usage.values()]);
  expect(summary).toMatchObject({
    inputTokens: 100,
    outputTokens: 25,
    cacheReadTokens: 1000,
    cacheWriteTokens: 200,
    isIncomplete: true,
  });
  expect(state.usage.get("partial:1")?.isPartial).toBe(true);
});
