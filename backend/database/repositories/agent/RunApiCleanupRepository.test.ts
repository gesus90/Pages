import { expect, it, vi } from "vitest";

import { RunApiCleanupRepository } from "./RunApiCleanupRepository";

import { Database } from "@/backend/database/Database";
import type { DatabaseValue } from "@/backend/database/Database";

function databaseOf(rows: DatabaseValue[][] = []): {
  readonly database: Database;
  readonly execute: ReturnType<typeof vi.fn>;
  readonly query: ReturnType<typeof vi.fn>;
} {
  const database = vi.mockObject(Database.prototype);
  const execute = vi.spyOn(database, "execute").mockResolvedValue();
  const query = vi.spyOn(database, "query").mockResolvedValue(rows);
  return { database, execute, query };
}

it("enqueues an idempotent closeout", async () => {
  const { database, execute } = databaseOf();
  await new RunApiCleanupRepository(database).enqueue({
    runId: "r1",
    stepId: "s1",
    attemptId: "a1",
  });
  expect(execute.mock.calls[0]?.[1]).toEqual({
    attempt_id: "a1",
    run_id: "r1",
    step_id: "s1",
  });
});

it("lists pending closeouts", async () => {
  const { database } = databaseOf([["a1", "r1", "s1"]]);
  await expect(
    new RunApiCleanupRepository(database).pending(),
  ).resolves.toEqual([{ attemptId: "a1", runId: "r1", stepId: "s1" }]);
});

it("completes a closeout by attempt", async () => {
  const { database, execute } = databaseOf();
  await new RunApiCleanupRepository(database).complete("a1");
  expect(execute.mock.calls[0]?.[1]).toEqual({ attempt_id: "a1" });
});
