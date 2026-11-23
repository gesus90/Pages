import { expect, it, vi } from "vitest";

import { CodexPlanUsageRepository } from "./CodexPlanUsageRepository";

import { codexAccountingSchema } from "@/definition/CodexPlanUsage";

import type { AgentSessionDatabase } from "./AgentSessionDatabase";
import type { DatabaseValue } from "@/backend/database/Database";
import type { AgentSessionTurnUsage } from "@/definition/AgentSessionJournal";
import type {
  CodexAccounting,
  CodexPrice,
  CodexThreadReport,
  CodexTokenCounts,
} from "@/definition/CodexPlanUsage";

type Rows = readonly (readonly DatabaseValue[])[];

const PRICE: CodexPrice = {
  modelId: "openai/gpt-5",
  catalogAt: "2026-01-01",
  prompt: 1,
  completion: 2,
  cache: 0.5,
  reasoning: 3,
};

function counts(overrides: Partial<CodexTokenCounts> = {}): CodexTokenCounts {
  return {
    inputTokens: null,
    cacheReadTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    ...overrides,
  };
}

function usageOf(
  overrides: Partial<AgentSessionTurnUsage> = {},
): AgentSessionTurnUsage {
  return {
    attemptId: "a1",
    turn: 1,
    provider: "codex_cli",
    model: "gpt-5",
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    totalTokens: null,
    inputIncludesCache: null,
    isPartial: false,
    reportedAt: "2026-01-02",
    ...overrides,
  };
}

function nativeUsage(
  report: Partial<CodexThreadReport>,
  overrides: Partial<AgentSessionTurnUsage> = {},
): AgentSessionTurnUsage {
  return usageOf({
    codex: {
      connectionId: "c1",
      agentId: "g1",
      report: {
        threadId: "t1",
        totals: counts(),
        baseline: false,
        model: "gpt-5",
        ...report,
      },
    },
    ...overrides,
  });
}

/** Answers each query by the first fragment its statement contains. */
function databaseOf(responses: Readonly<Record<string, Rows>> = {}): {
  readonly database: AgentSessionDatabase;
  readonly saved: () => Record<string, unknown>[];
  readonly writes: () => string[];
} {
  const query = vi.fn<AgentSessionDatabase["query"]>(async (statement) => {
    const key = Object.keys(responses).find((fragment) =>
      statement.includes(fragment),
    );
    return key === undefined
      ? []
      : (responses[key] ?? []).map((row) => [...row]);
  });
  const execute = vi.fn<AgentSessionDatabase["execute"]>(async () => {});
  const transaction: AgentSessionDatabase["transaction"] = (work) =>
    work({ execute, query });
  return {
    database: { execute, query, transaction },
    saved: () =>
      execute.mock.calls
        .filter(([statement]) => statement.includes("INTO agent_session_turn"))
        .map(([, parameters]) => ({ ...parameters })),
    writes: () => execute.mock.calls.map(([statement]) => statement),
  };
}

function accountingOf(
  saved: Record<string, unknown> | undefined,
): CodexAccounting {
  const text = saved?.["codex_accounting"];
  if (typeof text !== "string") throw new Error("No accounting was saved");
  return codexAccountingSchema.parse(JSON.parse(text));
}

const NO_BEFORE_TOKENS = [
  "a1",
  1,
  "codex_cli",
  "gpt-5",
  null,
  null,
  null,
  null,
  null,
  null,
  0,
  "t",
  null,
  null,
  null,
];

function storedRow(overrides: Record<number, DatabaseValue>): DatabaseValue[] {
  const row: DatabaseValue[] = [...NO_BEFORE_TOKENS];
  for (const [index, value] of Object.entries(overrides))
    row[Number(index)] = value;
  return row;
}

const CATALOG = JSON.stringify({
  fetchedAt: "2026-01-01",
  models: [
    {
      id: "openai/gpt-5-mini",
      pricing: { prompt: 1, completion: 2, input_cache_read: 0.5 },
    },
  ],
});

it("stores the reported turn tokens with an unpriced valuation", async () => {
  const { database, saved, writes } = databaseOf();
  await new CodexPlanUsageRepository(database).save(usageOf());
  expect(saved()[0]).toMatchObject({
    input_tokens: 10,
    output_tokens: 5,
    total_tokens: 15,
    reasoning_tokens: null,
    is_partial: false,
    codex_accounting: JSON.stringify({
      price: null,
      costUsd: null,
      isSubscription: true,
    }),
  });
  expect(writes().some((text) => text.includes("codex_plan_prices"))).toBe(
    true,
  );
});

it.each([{ model: null }, { inputTokens: null }, { outputTokens: null }])(
  "stores no price for %o",
  async (overrides) => {
    const { database, saved, writes } = databaseOf();
    await new CodexPlanUsageRepository(database).save(usageOf(overrides));
    expect(saved()).toHaveLength(1);
    expect(writes().some((text) => text.includes("codex_plan_prices"))).toBe(
      false,
    );
  },
);

it("leaves the total open when the output is unknown", async () => {
  const { database, saved } = databaseOf();
  await new CodexPlanUsageRepository(database).save(
    usageOf({ inputTokens: null, reasoningTokens: 2 }),
  );
  expect(saved()[0]).toMatchObject({ total_tokens: null, reasoning_tokens: 2 });
});

it.each([
  [JSON.stringify(PRICE), 10 * 1 + 5 * 2],
  ["null", null],
])("reuses the frozen price %s", async (frozen, cost) => {
  const { database, saved, writes } = databaseOf({
    "FROM codex_plan_prices": [[frozen]],
  });
  await new CodexPlanUsageRepository(database).save(usageOf());
  expect(accountingOf(saved()[0]).costUsd).toBe(cost);
  expect(writes().some((text) => text.includes("INTO codex_plan_prices"))).toBe(
    false,
  );
});

it("resolves the price through the mapping of the connection", async () => {
  const { database, saved } = databaseOf({
    codex_price_mappings: [['{"gpt-5":"openai/gpt-5-mini"}']],
    openrouter_price_catalog: [[CATALOG]],
  });
  await new CodexPlanUsageRepository(database).save(
    usageOf({
      codex: { connectionId: "c1", agentId: "g1", report: null },
    }),
  );
  expect(accountingOf(saved()[0]).price?.modelId).toBe("openai/gpt-5-mini");
});

it("claims native growth and adds it to the stored turn", async () => {
  const { database, saved } = databaseOf({
    "SELECT totals FROM codex_thread_usage": [
      [JSON.stringify(counts({ inputTokens: 100, outputTokens: 10 }))],
    ],
    "FROM agent_session_turn_usage": [
      storedRow({ 4: 5, 6: 3, 10: 1, 13: null }),
    ],
  });
  await new CodexPlanUsageRepository(database).save(
    nativeUsage({
      totals: counts({ inputTokens: 110, outputTokens: 14 }),
    }),
  );
  expect(saved()[0]).toMatchObject({
    input_tokens: 15,
    cache_read_tokens: 3,
    output_tokens: 14 - 10,
    total_tokens: 15 + 4,
    is_partial: true,
  });
});

it("stores a baseline without a turn", async () => {
  const { database, saved, writes } = databaseOf();
  await new CodexPlanUsageRepository(database).save(
    nativeUsage({ baseline: true, totals: counts({ inputTokens: 7 }) }),
  );
  expect(saved()).toEqual([]);
  expect(writes().some((text) => text.includes("codex_prompt_baselines"))).toBe(
    true,
  );
});

it("skips a replayed native report without growth", async () => {
  const same = JSON.stringify(counts({ inputTokens: 7, outputTokens: 0 }));
  const { database, saved } = databaseOf({
    "SELECT totals FROM codex_thread_usage": [[same]],
  });
  await new CodexPlanUsageRepository(database).save(
    nativeUsage({ totals: counts({ inputTokens: 7, outputTokens: 0 }) }),
  );
  expect(saved()).toEqual([]);
});

it("adds the prompt delta to the stored baseline of the turn", async () => {
  const { database, saved, writes } = databaseOf({
    "FROM codex_prompt_baselines": [
      [JSON.stringify(counts({ inputTokens: 100, outputTokens: 50 }))],
    ],
  });
  await new CodexPlanUsageRepository(database).save(
    nativeUsage({
      promptTokens: counts({
        inputTokens: 5,
        outputTokens: 2,
        reasoningTokens: 1,
      }),
    }),
  );
  expect(saved()[0]).toMatchObject({
    input_tokens: 105,
    output_tokens: 52,
    reasoning_tokens: 1,
    cache_read_tokens: null,
  });
  expect(
    writes().some((text) => text.includes("UPDATE codex_thread_usage")),
  ).toBe(true);
});

it("fails without the baseline of the turn", async () => {
  const { database } = databaseOf();
  await expect(
    new CodexPlanUsageRepository(database).save(
      nativeUsage({ promptTokens: counts({ inputTokens: 1 }) }),
    ),
  ).rejects.toThrow("Codex prompt baseline is missing");
});

it("keeps live native usage when the final response reports nothing", async () => {
  const { database, saved } = databaseOf({
    "FROM agent_session_turn_usage": [storedRow({ 4: 5 })],
  });
  await new CodexPlanUsageRepository(database).save(
    usageOf({ inputTokens: null, outputTokens: null }),
  );
  expect(saved()).toEqual([]);
});

it("keeps stored output tokens when the final response reports nothing", async () => {
  const { database, saved } = databaseOf({
    "FROM agent_session_turn_usage": [storedRow({ 5: 2 })],
  });
  await new CodexPlanUsageRepository(database).save(
    usageOf({ inputTokens: null, outputTokens: null }),
  );
  expect(saved()).toEqual([]);
});

it("writes an empty final response over a stored turn without tokens", async () => {
  const { database, saved } = databaseOf({
    "FROM agent_session_turn_usage": [storedRow({})],
  });
  await new CodexPlanUsageRepository(database).save(
    usageOf({ inputTokens: null, outputTokens: null }),
  );
  expect(saved()).toHaveLength(1);
});

it("treats a report that vanishes before the prompt step as unknown", async () => {
  let reads = 0;
  const source = {
    connectionId: "c1",
    agentId: "g1",
    get report(): CodexThreadReport | null {
      reads += 1;
      return reads === 1
        ? {
            threadId: "t1",
            totals: counts({ inputTokens: 4 }),
            baseline: false,
            model: "gpt-5",
          }
        : null;
    },
  };
  const { database, saved } = databaseOf();
  await new CodexPlanUsageRepository(database).save(usageOf({ codex: source }));
  expect(saved()[0]).toMatchObject({ input_tokens: null, total_tokens: null });
});

it("sums the stored monthly cost of an agent", async () => {
  const { database } = databaseOf({ "COALESCE(SUM": [["2.5"]] });
  await expect(
    new CodexPlanUsageRepository(database).monthlyCost("g1", "2026-01"),
  ).resolves.toBe(2.5);
});

it("has no monthly cost without a row", async () => {
  const { database } = databaseOf();
  await expect(
    new CodexPlanUsageRepository(database).monthlyCost("g1", "2026-01"),
  ).resolves.toBe(0);
});
