import { expect, it, vi } from "vitest";

import { writeAgentSessionUsage } from "./AgentSessionUsageWriter";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentSessionTurnUsage } from "@/definition/AgentSessionJournal";

const USAGE: AgentSessionTurnUsage = {
  attemptId: "a1",
  turn: 2,
  provider: "claude_code",
  model: "m1",
  inputTokens: 1,
  outputTokens: 2,
  cacheReadTokens: 3,
  cacheWriteTokens: 4,
  totalTokens: 10,
  inputIncludesCache: false,
  isPartial: true,
  reportedAt: "2026-01-01T00:00:00.000Z",
};

async function writtenParameters(
  usage: AgentSessionTurnUsage,
): Promise<Record<string, unknown>> {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  const query = vi.fn<DatabaseTransaction["query"]>(async () => []);
  await writeAgentSessionUsage({ execute, query }, usage);
  return { ...execute.mock.calls[0]?.[1] };
}

it("writes counters with empty optional values as null", async () => {
  expect(await writtenParameters(USAGE)).toEqual({
    attempt_id: "a1",
    turn: 2,
    provider: "claude_code",
    model: "m1",
    input_tokens: 1,
    output_tokens: 2,
    cache_read_tokens: 3,
    cache_write_tokens: 4,
    total_tokens: 10,
    input_includes_cache: false,
    is_partial: true,
    reported_at: "2026-01-01T00:00:00.000Z",
    reasoning_tokens: null,
    claude_accounting: null,
    codex_accounting: null,
  });
});

it("serializes both accountings and the reasoning tokens", async () => {
  const claudeAccounting = {
    sessionId: "s1",
    subscription: true,
    models: [],
    costUsd: null,
  };
  const accounting = { costUsd: 1.5, isSubscription: false, price: null };
  const parameters = await writtenParameters({
    ...USAGE,
    reasoningTokens: 7,
    claudeAccounting,
    accounting,
  });
  expect(parameters).toMatchObject({
    reasoning_tokens: 7,
    claude_accounting: JSON.stringify(claudeAccounting),
    codex_accounting: JSON.stringify(accounting),
  });
});
