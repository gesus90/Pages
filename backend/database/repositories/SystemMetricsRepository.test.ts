import { expect, it, vi } from "vitest";

import { SystemMetricsRepository } from "./SystemMetricsRepository";

import type { Database } from "@/backend/database/Database";

function repositoryOf(rows: unknown[][]): SystemMetricsRepository {
  const query = vi.fn(async () => rows);
  return new SystemMetricsRepository({ query } as unknown as Database);
}

it("reads the database size", async () => {
  await expect(repositoryOf([[4096]]).readDatabaseSize()).resolves.toBe(4096);
});

it("fails when the database answers no size", async () => {
  await expect(repositoryOf([]).readDatabaseSize()).rejects.toThrow(
    "Database returned no size",
  );
});
