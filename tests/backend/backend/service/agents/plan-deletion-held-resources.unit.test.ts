import { beforeEach, expect, it } from "vitest";

import { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import { AgentError } from "@/backend/error/AgentErrors";

import { PlanDatabase } from "./page61-plan-database";

import type { AgentPlan } from "@/definition/AgentPlan";

function plan(id: string): AgentPlan {
  return {
    id,
    ownerId: "owner",
    name: `Plan ${id}`,
    workspaceId: "workspace",
    projectId: "project",
    usage: "workspace",
    sharing: { isGlobal: true, targets: [], operator: "or" },
    globals: {},
    revision: 1,
    nodes: [
      { id: "start", type: "start", x: 0, y: 0 },
      { id: "end", type: "end", x: 300, y: 0 },
    ],
    edges: [
      { from: "start", to: "end", fromPort: "flow-out", toPort: "flow-in" },
    ],
  };
}

let database: PlanDatabase;
let repository: AgentPlanRepository;

beforeEach(() => {
  database = new PlanDatabase();
  database.insert(plan("held"));
  database.insert(plan("free"));
  repository = new AgentPlanRepository(database.asDatabase());
});

it("refuses to delete a plan while a finished run still holds a local owner or a workspace lock", async () => {
  database.heldPlans.add("held");
  database.rejections = ["held"];
  await expect(repository.remove("held", "owner")).rejects.toEqual(
    new AgentError("plan_resources_held"),
  );
  // The plan row, and with it its payload directory, stays for the release.
  expect((await repository.find("held"))?.id).toBe("held");
  expect(database.rejections).toEqual(["held"]);
});

it("deletes a plan whose runs released every owner and lock", async () => {
  database.heldPlans.add("held");
  await repository.remove("free", "owner");
  expect((await repository.list()).map((entry) => entry.id)).toEqual(["held"]);
});

it("reports a still running run before held resources", async () => {
  database.heldPlans.add("held");
  database.runs = [{ planId: "held", status: "running" }];
  await expect(repository.remove("held", "owner")).rejects.toEqual(
    new AgentError("plan_running"),
  );
});
