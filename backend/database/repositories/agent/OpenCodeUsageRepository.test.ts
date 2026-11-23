import { expect, it, vi } from "vitest";

import { OpenCodeUsageRepository } from "./OpenCodeUsageRepository";

import type { AgentSessionDatabase } from "./AgentSessionDatabase";
import type { DatabaseValue } from "@/backend/database/Database";
import type { StoredOpenCodeUsage } from "@/backend/service/agents/sessions/OpenCodeUsage";

function databaseOf(rows: DatabaseValue[][] = []): {
  readonly database: AgentSessionDatabase;
  readonly execute: ReturnType<typeof vi.fn<AgentSessionDatabase["execute"]>>;
  readonly query: ReturnType<typeof vi.fn<AgentSessionDatabase["query"]>>;
} {
  const execute = vi.fn<AgentSessionDatabase["execute"]>(async () => {});
  const query = vi.fn<AgentSessionDatabase["query"]>(async () => rows);
  const transaction: AgentSessionDatabase["transaction"] = (work) =>
    work({ execute, query });
  return { database: { execute, query, transaction }, execute, query };
}

function usageRow(
  overrides: Record<number, DatabaseValue> = {},
): DatabaseValue[] {
  const row: DatabaseValue[] = [
    "m1",
    "s1",
    "a1",
    2,
    "model",
    10,
    20n,
    30,
    40,
    50,
    "0.25",
    "catalog",
    "2026-01-01",
    "2026-01-02",
  ];
  for (const [index, value] of Object.entries(overrides))
    row[Number(index)] = value;
  return row;
}

const MESSAGE: StoredOpenCodeUsage = {
  id: "m1",
  sessionId: "s1",
  attemptId: "a1",
  turn: 2,
  model: "model",
  inputTokens: 10,
  outputTokens: 20,
  reasoningTokens: 30,
  cacheReadTokens: 40,
  cacheWriteTokens: 50,
  costUsd: null,
  price: { amount: 0.25, state: "catalog", priceAsOf: "2026-01-01" },
  reportedAt: "2026-01-02",
};

it("saves a message with its price", async () => {
  const { database, execute } = databaseOf();
  await new OpenCodeUsageRepository(database).save(MESSAGE);
  expect(execute.mock.calls[0]?.[1]).toEqual({
    message_id: "m1",
    session_id: "s1",
    attempt_id: "a1",
    turn: 2,
    model: "model",
    input_tokens: 10,
    output_tokens: 20,
    reasoning_tokens: 30,
    cache_read_tokens: 40,
    cache_write_tokens: 50,
    cost_usd: 0.25,
    price_state: "catalog",
    price_as_of: "2026-01-01",
    reported_at: "2026-01-02",
  });
});

it("lists the messages of a run", async () => {
  const { database, query } = databaseOf([usageRow()]);
  await expect(
    new OpenCodeUsageRepository(database).listRun("r1"),
  ).resolves.toEqual([MESSAGE]);
  expect(query.mock.calls[0]?.[1]).toEqual({ run_id: "r1" });
});

it("reads missing counters, model and price as null", async () => {
  const { database } = databaseOf([
    usageRow({
      4: null,
      5: null,
      6: null,
      7: null,
      8: null,
      9: null,
      10: null,
      11: "unknown",
      12: null,
    }),
  ]);
  const [message] = await new OpenCodeUsageRepository(database).listRun("r1");
  expect(message).toMatchObject({
    model: null,
    inputTokens: null,
    cacheWriteTokens: null,
    price: { amount: null, state: "unknown", priceAsOf: null },
  });
});

it.each([-1, "x", Number.NaN])(
  "drops the invalid amount %s",
  async (amount) => {
    const { database } = databaseOf([usageRow({ 10: amount, 11: "native" })]);
    const [message] = await new OpenCodeUsageRepository(database).listRun("r1");
    expect(message?.price).toMatchObject({ amount: null, state: "native" });
  },
);

it("accepts the free price state", async () => {
  const { database } = databaseOf([usageRow({ 10: 0, 11: "free" })]);
  const [message] = await new OpenCodeUsageRepository(database).listRun("r1");
  expect(message?.price).toMatchObject({ amount: 0, state: "free" });
});

it("rejects an invalid price state", async () => {
  const { database } = databaseOf([usageRow({ 11: "bogus" })]);
  await expect(
    new OpenCodeUsageRepository(database).listRun("r1"),
  ).rejects.toThrow("Invalid OpenCode price state");
});
