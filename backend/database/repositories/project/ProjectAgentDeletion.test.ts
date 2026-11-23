import { expect, it, vi, type Mock } from "vitest";

import { deleteProjectAgentData } from "./ProjectAgentDeletion";

import { ProjectRunsActiveError } from "@/backend/error/ProjectErrors";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

function databaseOf(
  leases: DatabaseValue[][],
  records: DatabaseValue[][] = [],
): {
  readonly execute: Mock<DatabaseTransaction["execute"]>;
  readonly query: Mock<DatabaseTransaction["query"]>;
} {
  const results = [leases, records];
  return {
    execute: vi.fn<DatabaseTransaction["execute"]>(async () => {}),
    query: vi.fn<DatabaseTransaction["query"]>(
      async () => results.shift() ?? [],
    ),
  };
}

it("refuses deletion while a run still has a lease or pending cleanup", async () => {
  const database = databaseOf([["instance"]]);
  await expect(deleteProjectAgentData(database, "p1")).rejects.toBeInstanceOf(
    ProjectRunsActiveError,
  );
  expect(database.execute).not.toHaveBeenCalled();
});

it("deletes the plans, runs and imports and returns the run records", async () => {
  const database = databaseOf([], [["agent-1", "run-1"]]);
  const keys = await deleteProjectAgentData(database, "p1");
  expect(keys).toEqual([{ agentId: "agent-1", runId: "run-1" }]);
  const statements = database.execute.mock.calls.map((call) => String(call[0]));
  expect(statements.some((text) => text.includes("agent_plans WHERE"))).toBe(
    true,
  );
  expect(statements.at(-1)).toContain("agent_import_sources");
  expect(
    database.execute.mock.calls.every((call) => call[1]?.project_id === "p1"),
  ).toBe(true);
});
