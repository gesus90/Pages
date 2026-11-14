import { expect, it, vi } from "vitest";

import { readCodexTokenCount } from "@/backend/agents/acp/CodexThreadUsage";
import { CodexAgentBudget } from "@/backend/service/agents/usage/CodexAgentBudget";
import { codexPromptTokens } from "@/backend/service/agents/usage/CodexPromptTokens";
import {
  codexRunUsage,
  sumCodexUsage,
} from "@/backend/service/agents/usage/CodexRunUsage";
import {
  codexHighWater,
  codexTokenCost,
  codexTokenDelta,
} from "@/backend/service/agents/usage/CodexUsageCalculation";
import { readCodexPriceMappings } from "@/backend/service/agents/usage/CodexPriceMappings";
import {
  parseOpenRouterPrices,
  resolveCodexPrice,
} from "@/backend/service/agents/usage/OpenRouterPrices";
import { OpenRouterPriceService } from "@/backend/service/agents/usage/OpenRouterPriceService";

import {
  sessionRecord,
  sessionRun,
  sessionStep,
} from "./page85-session-fixture";

import type { AgentPlanLoopRun } from "@/definition/AgentPlanLoopRun";
import type { CodexPrice, CodexTokenCounts } from "@/definition/CodexPlanUsage";
import type { AgentSessionTurnUsage } from "@/definition/AgentSessionJournal";

const TOKENS: CodexTokenCounts = {
  inputTokens: 100,
  cacheReadTokens: 40,
  outputTokens: 30,
  reasoningTokens: 10,
};
const PRICE: CodexPrice = {
  modelId: "openai/gpt-6-luna",
  catalogAt: "2026-11-14",
  prompt: 0.001,
  cache: 0.0001,
  completion: 0.01,
  reasoning: 0.02,
};

function usage(
  overrides: Partial<AgentSessionTurnUsage> = {},
): AgentSessionTurnUsage {
  return {
    ...TOKENS,
    attemptId: "a",
    turn: 1,
    provider: "codex_cli",
    model: "gpt-6-luna",
    cacheWriteTokens: null,
    totalTokens: 130,
    inputIncludesCache: true,
    isPartial: false,
    reportedAt: "2026-11-14T00:00:00Z",
    accounting: { costUsd: 0.464, price: PRICE, isSubscription: true },
    ...overrides,
  };
}

it("reads native totals rather than the last model call, preserving missing breakdowns", () => {
  const line = JSON.stringify({
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: 100,
          cached_input_tokens: 40,
          output_tokens: 30,
          reasoning_output_tokens: 10,
        },
        last_token_usage: { input_tokens: 9, output_tokens: 2 },
      },
    },
  });
  expect(readCodexTokenCount(line)).toEqual(TOKENS);
  expect(
    readCodexTokenCount(
      '{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":0,"output_tokens":0}}}}',
    ),
  ).toEqual({
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: null,
    reasoningTokens: null,
  });
  expect(
    readCodexTokenCount(
      '{"type":"event_msg","payload":{"type":"token_count","info":null}}',
    ),
  ).toBeNull();
  expect(readCodexTokenCount("not json")).toBeNull();
});

it("counts growth once across turns, repeated reports and stale resumed totals", () => {
  const next = {
    inputTokens: 180,
    cacheReadTokens: 60,
    outputTokens: 55,
    reasoningTokens: 15,
  };
  expect(codexTokenDelta(TOKENS, next)).toEqual({
    inputTokens: 80,
    cacheReadTokens: 20,
    outputTokens: 25,
    reasoningTokens: 5,
  });
  expect(codexTokenDelta(next, next)).toEqual({
    inputTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  });
  expect(codexHighWater(next, TOKENS)).toEqual(next);
  expect(codexTokenDelta(next, TOKENS)).toEqual({
    inputTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  });
});

it("normalizes stock ACP input (cache excluded), includes thought tokens and keeps unreported usage unknown", () => {
  expect(
    codexPromptTokens({
      inputTokens: 60,
      cachedReadTokens: 40,
      outputTokens: 30,
      thoughtTokens: 10,
      totalTokens: 130,
    }).tokens,
  ).toMatchObject({ ...TOKENS, inputIncludesCache: true });
  expect(
    codexPromptTokens({
      inputTokens: 100,
      cachedReadTokens: 40,
      outputTokens: 30,
      thoughtTokens: 10,
      totalTokens: 130,
    }).tokens.inputTokens,
  ).toBe(100);
  expect(
    codexPromptTokens({ inputTokens: -1, outputTokens: -1, totalTokens: -1 })
      .tokens.inputTokens,
  ).toBeNull();
  expect(codexPromptTokens(null).tokens).toMatchObject({
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    totalTokens: null,
    isPartial: true,
  });
});

it("prices cache and reasoning as subsets with base-rate fallback and unknown price semantics", () => {
  expect(codexTokenCost(TOKENS, PRICE)).toBeCloseTo(0.464);
  expect(
    codexTokenCost(
      { ...TOKENS, cacheReadTokens: null, reasoningTokens: null },
      PRICE,
    ),
  ).toBeCloseTo(0.4);
  expect(codexTokenCost(TOKENS, null)).toBeNull();
  const catalog = parseOpenRouterPrices(
    {
      data: [
        { id: PRICE.modelId, pricing: { prompt: "0.001", completion: "0.01" } },
      ],
    },
    "now",
  );
  expect(resolveCodexPrice(catalog, "gpt-6-luna")).toMatchObject({
    cache: 0.001,
    reasoning: 0.01,
  });
});

it("resolves exact or unambiguous OpenAI IDs and honors explicit mappings without inventing prices", () => {
  const catalog = parseOpenRouterPrices(
    {
      data: [
        {
          id: "openai/gpt-6-luna-2026-11-01",
          pricing: {
            prompt: "0.1",
            completion: "0.2",
            input_cache_read: "0.01",
            internal_reasoning: "0.3",
          },
        },
        { id: "openai/gpt-6.1-sol", pricing: { prompt: "0", completion: "0" } },
        { id: "openai/bad", pricing: { prompt: "-1", completion: "oops" } },
      ],
    },
    "2026-11-14",
  );
  expect(resolveCodexPrice(catalog, "gpt-6-luna")?.modelId).toBe(
    "openai/gpt-6-luna-2026-11-01",
  );
  expect(
    resolveCodexPrice(catalog, "unlisted", "openai/gpt-6.1-sol")?.prompt,
  ).toBe(0);
  expect(resolveCodexPrice(catalog, "bad")).toBeNull();
  expect(resolveCodexPrice(catalog, "gpt-6-luna", "missing/id")).toBeNull();
  const ambiguous = {
    ...catalog,
    models: [
      ...catalog.models,
      { ...catalog.models[0], id: "openai/gpt-6-luna-2026-11-02" },
    ],
  };
  expect(resolveCodexPrice(ambiguous, "gpt-6-luna")).toBeNull();
  expect(readCodexPriceMappings("gpt-6-luna = openai/gpt-6.1-sol")).toEqual({
    "gpt-6-luna": "openai/gpt-6.1-sol",
  });
  expect(readCodexPriceMappings("")).toEqual({});
  expect(() => readCodexPriceMappings("bad line")).toThrow();
  expect(() => readCodexPriceMappings("x = openai/a\nx = openai/b")).toThrow();
});

it("sums all persisted attempts, including iterations and retries, while missing usage marks the total incomplete", () => {
  const first = sessionStep(
    "outer",
    sessionRecord({ runner: "codex_cli", attemptId: "a" }),
  );
  const loopStep = sessionStep(
    "loop-member",
    sessionRecord({ runner: "codex_cli", attemptId: "b" }),
  );
  const loop: AgentPlanLoopRun = {
    id: "loop",
    name: "Loop",
    status: "succeeded",
    count: null,
    sessionPolicy: "fresh",
    condition: null,
    iterations: [1, 2].map((number) => ({
      id: `loop#${number}`,
      number,
      status: "succeeded",
      startedAt: "2026-11-14",
      endedAt: "2026-11-14",
      nodes: [
        sessionStep(
          "loop-member",
          sessionRecord({ runner: "codex_cli", attemptId: `loop-${number}` }),
        ),
      ],
      condition: { state: "not_evaluated", reason: "disabled" },
      error: null,
    })),
    sessions: [],
    completion: "count_reached",
    cleanup: "confirmed",
    startedAt: "2026-11-14",
    endedAt: "2026-11-14",
    error: null,
  };
  const run = sessionRun([first], { loops: [loop] });
  const turns = [
    usage({ stepId: "outer" }),
    usage({ attemptId: "b", stepId: "loop-member" }),
    usage({ attemptId: "old-retry", stepId: "outer" }),
  ];
  // Persisted loop attempts remain in the journal even after the canvas advances to another iteration.
  const summary = codexRunUsage(
    { ...run, loops: [], steps: [first, loopStep] },
    turns,
  );
  expect(summary.total).toMatchObject({
    inputTokens: 300,
    cacheReadTokens: 120,
    outputTokens: 90,
    reasoningTokens: 30,
    isPartial: false,
  });
  expect(summary.total.costUsd).toBeCloseTo(1.392);
  expect(summary.steps.map((step) => step.usage.inputTokens)).toEqual([
    200, 100,
  ]);
  const loopSummary = codexRunUsage(run, [
    usage({ stepId: "outer" }),
    usage({ attemptId: "loop-1", stepId: "loop-member" }),
    usage({ attemptId: "loop-2", stepId: "loop-member" }),
  ]);
  expect(loopSummary.total.inputTokens).toBe(300);
  expect(loopSummary.total.isPartial).toBe(false);
  expect(loopSummary.steps[1].usage.inputTokens).toBe(200);
  const missing = codexRunUsage({ ...run, steps: [first, loopStep] }, [
    turns[0],
  ]);
  expect(missing.total.isPartial).toBe(true);
  expect(missing.steps[1].usage.inputTokens).toBeNull();
  expect(sumCodexUsage([usage({ accounting: undefined })]).isPriceUnknown).toBe(
    true,
  );
});

it("refreshes startup/daily without credentials and preserves the last catalog offline", async () => {
  vi.useFakeTimers();
  const save = vi.fn(async () => undefined);
  const request = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        data: [
          {
            id: PRICE.modelId,
            pricing: { prompt: "0.1", completion: "0.2" },
          },
        ],
      }),
    ),
  );
  const service = new OpenRouterPriceService({ save }, request);
  await service.start();
  await vi.advanceTimersByTimeAsync(1);
  expect(save).toHaveBeenCalledTimes(1);
  const anySignal: AbortSignal = expect.any(AbortSignal) as AbortSignal;
  expect(request).toHaveBeenCalledWith("https://openrouter.ai/api/v1/models", {
    signal: anySignal,
  });
  request.mockRejectedValue(new Error("offline"));
  await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1_000);
  expect(request).toHaveBeenCalledTimes(2);
  expect(save).toHaveBeenCalledTimes(1);
  service.stop();
  vi.useRealTimers();
});

it("enforces the monthly agent limit from the same stored equivalent, including subscription work", async () => {
  const monthlyCost = vi.fn(async () => 0.464);
  const budget = new CodexAgentBudget({ monthlyCost });
  await expect(budget.requireAvailable("agent", 0.5)).resolves.toBeUndefined();
  await expect(budget.requireAvailable("agent", 0.464)).rejects.toMatchObject({
    code: "codex_monthly_cost_limit",
  });
  await expect(
    budget.requireAvailable("agent", undefined),
  ).resolves.toBeUndefined();
  expect(monthlyCost).toHaveBeenCalledTimes(2);
});
