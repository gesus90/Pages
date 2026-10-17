import { expect, it } from "vitest";

import {
  ACP_USAGE_CAPABILITIES,
  readContextUsage,
  readTurnTokens,
  sumTurnUsage,
  withTurnUsage,
} from "@/backend/service/agents/sessions/AgentSessionUsage";

import type { AgentSessionTurnUsage } from "@/definition/AgentSessionJournal";

const AT = "2026-10-17T01:00:00.000Z";

function turn(
  attemptId: string,
  number: number,
  overrides: Partial<AgentSessionTurnUsage> = {},
): AgentSessionTurnUsage {
  return {
    attemptId,
    turn: number,
    provider: "claude_code",
    model: "claude-opus-5-5",
    inputTokens: 100,
    outputTokens: 10,
    cacheReadTokens: 1_000,
    cacheWriteTokens: null,
    totalTokens: 1_110,
    inputIncludesCache: false,
    isPartial: false,
    reportedAt: AT,
    ...overrides,
  };
}

it("reports no percentage without a context limit and keeps a zero occupancy unknown", () => {
  expect(readContextUsage({ used: 50_000, size: 0 }, AT)).toEqual({
    contextUsed: 50_000,
    contextLimit: null,
    percent: null,
    source: "acp_usage_update",
    reportedAt: AT,
  });
  expect(readContextUsage({ used: 0, size: 200_000 }, AT)).toMatchObject({
    contextUsed: null,
    contextLimit: 200_000,
    percent: null,
  });
  expect(readContextUsage({ used: 50_000, size: 200_000 }, AT).percent).toBe(
    25,
  );
  expect(readContextUsage({ used: 0, size: 0 }, AT).source).toBeNull();
});

it("keeps missing token counts null instead of zero and records the cache semantics", () => {
  const read = readTurnTokens(
    ACP_USAGE_CAPABILITIES.claude_code,
    { inputTokens: 112_000, outputTokens: 1_200, totalTokens: 113_200 },
    null,
  );
  expect(read?.tokens).toEqual({
    inputTokens: 112_000,
    outputTokens: 1_200,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    totalTokens: 113_200,
    inputIncludesCache: false,
    isPartial: false,
  });
  expect(readTurnTokens(ACP_USAGE_CAPABILITIES.codex_cli, null, null)).toBe(
    null,
  );
  expect(
    readTurnTokens(
      ACP_USAGE_CAPABILITIES.opencode,
      { inputTokens: 5, outputTokens: 1, totalTokens: 6 },
      null,
    )?.tokens,
  ).toMatchObject({ isPartial: true, inputIncludesCache: null });
});

it("derives a turn from running totals, detects a reset and never double counts", () => {
  const capability = {
    counting: "session_total" as const,
    inputIncludesCache: true,
    isPartial: false,
  };
  const first = {
    inputTokens: 100,
    outputTokens: 10,
    totalTokens: 110,
    cachedReadTokens: 50,
  };
  const second = {
    inputTokens: 250,
    outputTokens: 30,
    totalTokens: 280,
    cachedReadTokens: 80,
  };
  expect(readTurnTokens(capability, second, first)).toEqual({
    isReset: false,
    tokens: {
      inputTokens: 150,
      outputTokens: 20,
      cacheReadTokens: 30,
      cacheWriteTokens: null,
      totalTokens: 170,
      inputIncludesCache: true,
      isPartial: false,
    },
  });
  // A new native session starts its totals again; the report counts on its own.
  const reset = readTurnTokens(
    capability,
    { inputTokens: 40, outputTokens: 4, totalTokens: 44 },
    second,
  );
  expect(reset?.isReset).toBe(true);
  expect(reset?.tokens.inputTokens).toBe(40);
  // A prompt-scoped adapter ignores the report before it.
  expect(
    readTurnTokens(ACP_USAGE_CAPABILITIES.claude_code, second, first)?.tokens
      .inputTokens,
  ).toBe(250);
});

it("replaces a repeated report of the same turn and sums attempts and runs without doubles", () => {
  const recorded = [turn("a", 1), turn("a", 2)].reduce<
    readonly AgentSessionTurnUsage[]
  >((turns, next) => withTurnUsage(turns, next), []);
  const repeated = withTurnUsage(recorded, turn("a", 2, { outputTokens: 20 }));
  expect(repeated).toHaveLength(2);
  const [total] = sumTurnUsage([
    ...repeated,
    turn("a", 2, { outputTokens: 20 }),
  ]);
  expect(total).toMatchObject({
    provider: "claude_code",
    turns: 2,
    inputTokens: 200,
    outputTokens: 30,
    cacheReadTokens: 2_000,
    cacheWriteTokens: null,
    isPartial: false,
  });
});

it("keeps provider countings apart, marks gaps as partial and lists model changes", () => {
  const totals = sumTurnUsage([
    turn("a", 1),
    turn("a", 2, { model: "claude-sonnet-5-5", cacheReadTokens: null }),
    turn("b", 1, {
      provider: "codex_cli",
      model: "gpt-5",
      inputIncludesCache: null,
      cacheReadTokens: 7,
    }),
  ]);
  expect(totals).toHaveLength(2);
  const claude = totals.find((total) => total.provider === "claude_code");
  const codex = totals.find((total) => total.provider === "codex_cli");
  expect(claude).toMatchObject({
    turns: 2,
    cacheReadTokens: 1_000,
    isPartial: true,
    models: ["claude-opus-5-5", "claude-sonnet-5-5"],
  });
  expect(codex).toMatchObject({
    turns: 1,
    inputTokens: 100,
    cacheReadTokens: 7,
    inputIncludesCache: null,
  });
});

it("never takes the context occupancy for token counts", () => {
  const context = readContextUsage({ used: 90_000, size: 200_000 }, AT);
  expect(context).not.toHaveProperty("inputTokens");
  expect(sumTurnUsage([])).toEqual([]);
});
