import { expect, it, vi } from "vitest";

import { OpenRouterPriceRepository } from "./OpenRouterPriceRepository";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { OpenRouterPrices } from "@/backend/service/agents/usage/OpenRouterPrices";

const CATALOG: OpenRouterPrices = { fetchedAt: "2026-01-01", models: [] };

function databaseOf(rows: DatabaseValue[][] = []): {
  readonly database: DatabaseTransaction;
  readonly execute: ReturnType<typeof vi.fn<DatabaseTransaction["execute"]>>;
} {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  const query = vi.fn<DatabaseTransaction["query"]>(async () => rows);
  return { database: { execute, query }, execute };
}

it("reads the validated catalog", async () => {
  const { database } = databaseOf([[JSON.stringify(CATALOG)]]);
  await expect(new OpenRouterPriceRepository(database).read()).resolves.toEqual(
    CATALOG,
  );
});

it("returns null without a stored catalog", async () => {
  const { database } = databaseOf();
  await expect(
    new OpenRouterPriceRepository(database).read(),
  ).resolves.toBeNull();
});

it("rejects a stored catalog of the wrong shape", async () => {
  const { database } = databaseOf([['{"fetchedAt":1}']]);
  await expect(
    new OpenRouterPriceRepository(database).read(),
  ).rejects.toThrow();
});

it("saves the catalog as JSON", async () => {
  const { database, execute } = databaseOf();
  await new OpenRouterPriceRepository(database).save(CATALOG);
  expect(execute.mock.calls[0]?.[1]).toEqual({
    payload: JSON.stringify(CATALOG),
  });
});
