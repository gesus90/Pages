import { expect, it } from "vitest";

import { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import { AgentError } from "@/backend/error/AgentErrors";

import { PlanDatabase } from "../../service/agents/page61-plan-database";
import { runnablePlan } from "../../service/agents/plan-operation-world";

import type {
  Database,
  DatabaseValue,
  SqlParameters,
} from "@/backend/database/Database";

/** Answers the run list query with fixed rows and records what was asked. */
function runDatabase(rows: DatabaseValue[][]): {
  readonly database: Database;
  readonly calls: { statement: string; parameters: SqlParameters }[];
} {
  const calls: { statement: string; parameters: SqlParameters }[] = [];
  const query = async (
    statement: string,
    parameters: SqlParameters = {},
  ): Promise<DatabaseValue[][]> => {
    calls.push({ statement, parameters });
    return rows;
  };
  const database: Pick<Database, "query"> = { query };
  return { database: database as Database, calls };
}

it("lists one person's runs of a plan by start, in the requested direction, without results", async () => {
  const { database, calls } = runDatabase([
    ["run-2", "2026-10-14T10:02:00.000Z", "failed"],
    ["run-1", "2026-10-14T10:01:00.000Z", "succeeded"],
  ]);
  const runs = new AgentPlanRunRepository(database);

  const newest = await runs.entries("owner", "plan-a", "newest");
  await runs.entries("owner", "plan-a", "oldest");

  expect(newest).toEqual([
    { id: "run-2", startedAt: "2026-10-14T10:02:00.000Z", status: "failed" },
    { id: "run-1", startedAt: "2026-10-14T10:01:00.000Z", status: "succeeded" },
  ]);
  expect(calls[0].parameters).toEqual({ user_id: "owner", plan_id: "plan-a" });
  expect(calls[0].statement).toContain("ORDER BY started_at DESC, id DESC");
  expect(calls[1].statement).toContain("ORDER BY started_at ASC, id ASC");
  expect(calls[0].statement).not.toContain("view_json");
  expect(calls[0].statement).not.toContain("snapshot_json");
});

it("refuses a stored run status it does not know", async () => {
  const { database } = runDatabase([["run-1", "2026-10-14", "exploded"]]);

  await expect(
    new AgentPlanRunRepository(database).entries("owner", "plan-a", "newest"),
  ).rejects.toMatchObject({ code: "plan_invalid" });
});

it("commits the journal of a plan save with the plan, and neither without the other", async () => {
  const plans = new PlanDatabase();
  plans.workspaces.set("workspace-1", "project-1");
  plans.agents.add("agent-reviewer");
  plans.insert(runnablePlan("plan-a"));
  const repository = new AgentPlanRepository(plans.asDatabase());
  const journaled: string[] = [];

  await repository.save(
    { ...runnablePlan("plan-a"), name: "Renamed" },
    false,
    async () => {
      journaled.push("stored");
    },
  );
  await expect(
    repository.save(
      { ...runnablePlan("plan-a"), name: "Lost", revision: 2 },
      false,
      async () => {
        throw new AgentError("plan_conflict");
      },
    ),
  ).rejects.toMatchObject({ code: "plan_conflict" });

  expect(journaled).toEqual(["stored"]);
  expect((await repository.find("plan-a"))?.name).toBe("Renamed");
});
