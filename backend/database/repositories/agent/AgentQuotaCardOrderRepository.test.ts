import { expect, it, vi } from "vitest";

import { AgentQuotaCardOrderRepository } from "./AgentQuotaCardOrderRepository";

import type { Database, DatabaseValue } from "@/backend/database/Database";

function databaseOf(rows: DatabaseValue[][] = []): {
  readonly database: Pick<Database, "query" | "execute">;
  readonly execute: ReturnType<typeof vi.fn<Database["execute"]>>;
  readonly query: ReturnType<typeof vi.fn<Database["query"]>>;
} {
  const execute = vi.fn<Database["execute"]>(async () => {});
  const query = vi.fn<Database["query"]>(async () => rows);
  return { database: { execute, query }, execute, query };
}

it("reads the stored order of an account as JSON text", async () => {
  const { database, query } = databaseOf([['["c1","c2"]']]);
  await expect(
    new AgentQuotaCardOrderRepository(database).readJson("u1"),
  ).resolves.toBe('["c1","c2"]');
  expect(query.mock.calls[0]?.[1]).toEqual({ user_id: "u1" });
});

it("returns null for an account that never sorted its cards", async () => {
  const { database } = databaseOf();
  await expect(
    new AgentQuotaCardOrderRepository(database).readJson("u1"),
  ).resolves.toBeNull();
});

it("writes the order and replaces the stored one", async () => {
  const { database, execute } = databaseOf();
  await new AgentQuotaCardOrderRepository(database).writeJson("u1", {
    connectionIdsJson: '["c2"]',
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  expect(execute.mock.calls[0]?.[1]).toEqual({
    user_id: "u1",
    connection_ids_json: '["c2"]',
    updated_at: "2026-01-01T00:00:00.000Z",
  });
});
