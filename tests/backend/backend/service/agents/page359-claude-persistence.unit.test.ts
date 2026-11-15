import { expect, it, vi } from "vitest";

import { AgentSessionRepository } from "@/backend/database/repositories/agent/AgentSessionRepository";
import { ClaudeUsageRepository } from "@/backend/database/repositories/agent/ClaudeUsageRepository";
import { readUsageRow } from "@/backend/database/repositories/agent/AgentSessionRows";
import { withClaudeRunUsage } from "@/backend/service/agents/AgentPlanRunReader";
import { readPlanPollingResponse } from "@/app/lib/agent-plan-poll";

import { sessionRun } from "./page85-session-fixture";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentSessionDatabase } from "@/backend/database/repositories/agent/AgentSessionDatabase";
import type { AgentSessionTurnUsage } from "@/definition/AgentSessionJournal";

function usage(): AgentSessionTurnUsage {
  return {
    attemptId: "first",
    turn: 1,
    provider: "claude_code",
    model: "claude-haiku-5-5",
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 1000,
    cacheWriteTokens: 200,
    totalTokens: 1320,
    inputIncludesCache: false,
    isPartial: false,
    reportedAt: "2026-11-13T12:00:00Z",
    claudeAccounting: {
      sessionId: "native",
      subscription: true,
      models: [
        {
          model: "claude-haiku-5-5",
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 1000,
          cacheWriteTokens: 200,
          price: {
            modelId: "anthropic/claude-haiku-5.5",
            fetchedAt: "2026-11-13T00:00:00Z",
            prompt: "0.000001",
            completion: "0.000005",
            cacheRead: "0.0000001",
            cacheWrite: "0.00000125",
          },
        },
      ],
      costUsd: 0.00055,
    },
  };
}

it("persists the exact prices and calculated amount with token counts and reads them unchanged offline", async () => {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => undefined);
  const database: AgentSessionDatabase = {
    query: async () => [],
    execute,
    transaction: async (work) => work(database),
  };
  await new AgentSessionRepository(database).saveTurnUsage(usage());
  const parameters = execute.mock.calls[0]?.[1];
  expect(parameters).toMatchObject({
    input_tokens: 100,
    output_tokens: 20,
    cache_read_tokens: 1000,
    cache_write_tokens: 200,
  });
  const stored = parameters?.claude_accounting;
  const row = [
    "first",
    1,
    "claude_code",
    "claude-haiku-5-5",
    100,
    20,
    1000,
    200,
    1320,
    0,
    0,
    "2026-11-13T12:00:00Z",
    typeof stored === "string" ? stored : null,
  ];
  expect(readUsageRow(row)).toEqual(usage());
  expect(execute.mock.calls[0]?.[0]).toContain(
    "ON CONFLICT (attempt_id, turn) DO UPDATE",
  );
});

it("locks the native session and retains its durable high watermark independently of a run", async () => {
  const state = { settled: [], messages: {}, seen: ["total:r1"] };
  const query = vi.fn<DatabaseTransaction["query"]>(async () => [
    [JSON.stringify(state)],
  ]);
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => undefined);
  const repository = new ClaudeUsageRepository({ query, execute });
  expect(await repository.lock("native")).toEqual(state);
  expect(query.mock.calls[0]?.[0]).toContain("FOR UPDATE");
  await repository.save("native", state);
  expect(execute.mock.calls[1]?.[1]).toEqual({
    session_id: "native",
    state: JSON.stringify(state),
  });
});

it("retains live accounting across the authorized read projection and the real browser polling parser", async () => {
  const listRunUsage = vi.fn(async () => [usage()]);
  const projected = await withClaudeRunUsage(
    { usage: { listRunUsage } },
    sessionRun([]),
  );
  const response = readPlanPollingResponse({
    ok: true,
    intent: "poll-run",
    run: projected,
  });
  expect(response.ok).toBe(true);
  if (!response.ok) throw new Error("Polling projection was refused");
  expect(response.run?.claudeUsage?.total).toMatchObject({
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 1000,
    cacheWriteTokens: 200,
    costUsd: 0.00055,
  });
  expect(response.run?.claudeUsage?.steps[0]?.usage).toEqual(
    response.run?.claudeUsage?.total,
  );
});
