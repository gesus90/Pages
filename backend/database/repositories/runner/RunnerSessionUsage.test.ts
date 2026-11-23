import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ write: vi.fn(async () => undefined) }));
vi.mock("../agent/AgentSessionUsageWriter", () => ({
  writeAgentSessionUsage: mocks.write,
}));

import { persistRunnerSessionUsage } from "./RunnerSessionUsage";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentPlanStepResult } from "@/definition/AgentPlan";

const TRANSACTION = {} as unknown as DatabaseTransaction;
const USAGE = {
  inputTokens: 10,
  outputTokens: 5,
  cacheReadTokens: 0,
  cacheWriteTokens: null,
  totalTokens: 15,
};

function step(overrides: {
  runner?: string;
  attemptId?: string | null;
  usage?: object;
  terminal?: boolean;
  endedAt?: string;
}): AgentPlanStepResult {
  return {
    session: {
      runner: overrides.runner ?? "claude_code",
      attemptId:
        overrides.attemptId === null
          ? undefined
          : (overrides.attemptId ?? "a1"),
      requested: { model: "m" },
    },
    remote: {
      ...(overrides.endedAt ? { endedAt: overrides.endedAt } : {}),
      ...(overrides.terminal === false
        ? {}
        : { terminal: { usage: overrides.usage ?? USAGE } }),
    },
  } as unknown as AgentPlanStepResult;
}

beforeEach(() => mocks.write.mockClear());

it("writes the reading of a native provider", async () => {
  await persistRunnerSessionUsage(
    TRANSACTION,
    step({ endedAt: "2026-01-01T00:00:00.000Z" }),
  );

  expect(mocks.write).toHaveBeenCalledWith(
    TRANSACTION,
    expect.objectContaining({
      attemptId: "a1",
      turn: 1,
      provider: "claude_code",
      model: "m",
      reportedAt: "2026-01-01T00:00:00.000Z",
    }),
  );
});

it("stamps the current time without an end time", async () => {
  await persistRunnerSessionUsage(TRANSACTION, step({ runner: "codex_cli" }));

  expect(mocks.write).toHaveBeenCalledTimes(1);
});

it("skips steps without a terminal, an attempt or a native provider", async () => {
  await persistRunnerSessionUsage(TRANSACTION, step({ terminal: false }));
  await persistRunnerSessionUsage(TRANSACTION, step({ attemptId: null }));
  await persistRunnerSessionUsage(TRANSACTION, step({ runner: "api" }));
  await persistRunnerSessionUsage(TRANSACTION, step({ runner: "openrouter" }));
  await persistRunnerSessionUsage(
    TRANSACTION,
    {} as unknown as AgentPlanStepResult,
  );

  expect(mocks.write).not.toHaveBeenCalled();
});

it("skips a terminal without any reading", async () => {
  await persistRunnerSessionUsage(
    TRANSACTION,
    step({
      usage: {
        inputTokens: null,
        outputTokens: null,
        cacheReadTokens: null,
      },
    }),
  );

  expect(mocks.write).not.toHaveBeenCalled();
});
