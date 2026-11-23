import { expect, it, vi } from "vitest";

import { persistRunnerSessionReading } from "./RunnerSessionReadings";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { RunnerSessionReading } from "@/definition/RunnerSessionReading";

type Call = (...parameters: unknown[]) => Promise<undefined>;

const REPORTED = "2026-05-02T10:00:00.000Z";
const EARLIER = "2026-05-01T10:00:00.000Z";
const LATER = "2026-05-03T10:00:00.000Z";

function transactionOf(rows: unknown[][]): {
  transaction: DatabaseTransaction;
  execute: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn<Call>(async () => undefined);
  const transaction = {
    query: vi.fn(async () => rows),
    execute,
  } as unknown as DatabaseTransaction;
  return { transaction, execute };
}

async function written(
  rows: unknown[][],
  reading: RunnerSessionReading,
): Promise<Record<string, unknown> | null> {
  const access = transactionOf(rows);
  await persistRunnerSessionReading(access.transaction, {
    attemptId: "a1",
    reading,
    reportedAt: REPORTED,
  });
  return (access.execute.mock.calls[0]?.[1] as Record<string, unknown>) ?? null;
}

it("ignores an unknown attempt", async () => {
  expect(await written([], { model: "m", context: null })).toBeNull();
});

it("ignores a provider without readings", async () => {
  const row = ["api", null, null, null, null, null, null];

  expect(await written([row], { model: "m", context: null })).toBeNull();
});

it("ignores a reading older than a stored value", async () => {
  const lateModel = ["claude_code", "m", LATER, null, null, null, null];
  const lateContext = ["claude_code", "m", null, 1, 2, "x", LATER];

  expect(await written([lateModel], { model: "m", context: null })).toBeNull();
  expect(
    await written([lateContext], { model: "m", context: null }),
  ).toBeNull();
});

it("ignores a context source the provider does not use", async () => {
  const row = ["claude_code", "m", null, null, null, null, null];

  expect(
    await written([row], {
      model: "m",
      context: { used: 1, limit: 2, source: "codex_token_count" },
    }),
  ).toBeNull();
});

it("ignores an adapter reading of another model", async () => {
  const row = ["opencode", "old", null, null, null, null, null];

  expect(
    await written([row], {
      model: "new",
      context: { used: 1, limit: 2, source: "acp_usage_update" },
    }),
  ).toBeNull();
});

it("stores a CLI model with a new context", async () => {
  const row = [
    "claude_code",
    "m",
    EARLIER,
    5,
    10,
    "cli_assistant_usage",
    EARLIER,
  ];

  const params = await written([row], {
    model: "m",
    context: { used: 7, limit: null, source: "cli_compact_boundary" },
  });

  expect(params).toMatchObject({
    confirmed_model: "m",
    confirmed_model_source: "cli_stream_event",
    confirmed_model_at: EARLIER,
    updates_reasoning: false,
    reasoning: null,
    reasoning_source: null,
    reasoning_at: null,
    context_used: 7,
    context_limit: 10,
    context_source: "cli_compact_boundary",
    context_at: REPORTED,
  });
});

it("keeps the context of the same model without a new context", async () => {
  const row = ["codex_cli", "m", null, 5, 10, "codex_token_count", EARLIER];

  const params = await written([row], { model: "m", context: null });

  expect(params).toMatchObject({
    confirmed_model_at: REPORTED,
    context_used: 5,
    context_limit: 10,
    context_source: "codex_token_count",
    context_at: EARLIER,
  });
});

it("keeps the context when the reading names no value", async () => {
  const row = ["codex_cli", "m", null, 5, 10, "codex_token_count", EARLIER];

  const params = await written([row], {
    model: "m",
    context: { used: null, limit: null, source: "codex_token_count" },
  });

  expect(params).toMatchObject({ context_used: 5, context_at: EARLIER });
});

it("drops the context of another model", async () => {
  const row = ["codex_cli", "old", null, 5, 10, "codex_token_count", EARLIER];

  const params = await written([row], { model: "new", context: null });

  expect(params).toMatchObject({
    confirmed_model_at: REPORTED,
    context_used: null,
    context_limit: null,
    context_source: null,
    context_at: null,
  });
});

it("takes a reported limit and keeps the stored occupancy", async () => {
  const row = ["codex_cli", "m", null, 5, null, null, null];

  const params = await written([row], {
    model: "m",
    context: { used: null, limit: 20, source: "codex_token_count" },
  });

  expect(params).toMatchObject({ context_used: 5, context_limit: 20 });
});

it("stores adapter reasoning", async () => {
  const row = ["opencode", "m", null, null, null, null, null];

  const params = await written([row], {
    model: "m",
    reasoning: "high",
    context: { used: 1, limit: 2, source: "acp_usage_update" },
  });

  expect(params).toMatchObject({
    confirmed_model_source: "adapter_selector",
    updates_reasoning: true,
    reasoning: "high",
    reasoning_source: "adapter_selector",
    reasoning_at: REPORTED,
  });
});

it("clears the reasoning when an adapter model changes", async () => {
  const row = ["antigravity", "old", null, null, null, null, null];

  const params = await written([row], { model: "new", context: null });

  expect(params).toMatchObject({
    updates_reasoning: true,
    reasoning: null,
    reasoning_source: null,
  });
});

it("keeps the reasoning when an adapter model stays and none is reported", async () => {
  const row = ["openrouter", "m", null, null, null, null, null];

  const params = await written([row], { model: "m", context: null });

  expect(params).toMatchObject({ updates_reasoning: false });
});
