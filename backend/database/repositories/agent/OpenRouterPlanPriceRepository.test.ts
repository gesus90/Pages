import { expect, it, vi } from "vitest";

import { OpenRouterPlanPriceRepository } from "./OpenRouterPlanPriceRepository";

import type { Database, DatabaseValue } from "@/backend/database/Database";

function databaseOf(rows: DatabaseValue[][] = []): {
  readonly database: Database;
  readonly execute: ReturnType<typeof vi.fn<Database["execute"]>>;
} {
  const execute = vi.fn<Database["execute"]>(async () => {});
  const query = vi.fn<Database["query"]>(async () => rows);
  return { database: { execute, query } as unknown as Database, execute };
}

it("loads the saved catalog", async () => {
  const { database } = databaseOf([["2026-01-01", '{"a":1}']]);
  await expect(
    new OpenRouterPlanPriceRepository(database).load(),
  ).resolves.toEqual({ fetchedAt: "2026-01-01", prices: { a: 1 } });
});

it.each([[[]], [[[null, "{}"]]], [[["2026-01-01", null]]]])(
  "returns null without a complete saved catalog",
  async (rows: DatabaseValue[][]) => {
    const { database } = databaseOf(rows);
    await expect(
      new OpenRouterPlanPriceRepository(database).load(),
    ).resolves.toBeNull();
  },
);

it("saves the catalog with its fetch time", async () => {
  const { database, execute } = databaseOf();
  await new OpenRouterPlanPriceRepository(database).save({
    fetchedAt: "2026-01-02",
    prices: {
      b: {
        prompt: 1,
        completion: 2,
        inputCacheRead: 0,
        inputCacheWrite: 0,
        internalReasoning: 0,
      },
    },
  });
  expect(execute.mock.calls[0]?.[1]).toEqual({
    fetched_at: "2026-01-02",
    prices: JSON.stringify({
      b: {
        prompt: 1,
        completion: 2,
        inputCacheRead: 0,
        inputCacheWrite: 0,
        internalReasoning: 0,
      },
    }),
  });
});
