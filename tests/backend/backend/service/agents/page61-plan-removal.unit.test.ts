import { beforeEach, expect, it } from "vitest";

import { removePlanLink } from "@/app/components/agents/plans/plan-links";
import { removePlanNode } from "@/app/components/agents/plans/plan-node-factory";
import { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import { AgentError } from "@/backend/error/AgentErrors";

import { PlanDatabase } from "./page61-plan-database";

import type { AgentPlan } from "@/definition/AgentPlan";

const FLOW = { fromPort: "flow-out", toPort: "flow-in" } as const;

function plan(id: string, name: string): AgentPlan {
  return {
    id,
    ownerId: "owner",
    name,
    workspaceId: "workspace",
    projectId: "project",
    usage: "workspace",
    sharing: { isGlobal: true, targets: [], operator: "or" },
    globals: {},
    revision: 3,
    nodes: [
      { id: "start", type: "start", x: 0, y: 0 },
      {
        id: "first",
        type: "agent",
        x: 300,
        y: 0,
        agentId: "agent",
        personalAgentId: null,
        instruction: "",
        bindings: { ticket: { kind: "source", nodeId: "ticket" } },
      },
      {
        id: "second",
        type: "agent",
        x: 600,
        y: 0,
        agentId: "agent",
        personalAgentId: null,
        instruction: "",
        bindings: { notes: { kind: "result", stepId: "first" } },
      },
      { id: "end", type: "end", x: 900, y: 0 },
      { id: "ticket", type: "task", x: 0, y: 300, taskId: "ticket-id" },
    ],
    edges: [
      { from: "start", to: "first", ...FLOW },
      { from: "first", to: "second", ...FLOW },
      { from: "second", to: "end", ...FLOW },
    ],
  };
}

let database: PlanDatabase;
let repository: AgentPlanRepository;

beforeEach(() => {
  database = new PlanDatabase();
  database.insert(plan("kept", "Kept plan"));
  database.insert(plan("deleted", "Deleted plan"));
  repository = new AgentPlanRepository(database.asDatabase());
});

it("keeps a removed connection and a removed node with its connections removed after saving and reopening", async () => {
  const opened = await repository.find("kept");
  if (!opened) throw new Error("Missing synthetic plan");
  const withoutTicketLink = removePlanLink(opened, {
    kind: "data",
    from: "ticket",
    to: "first",
    parameter: "ticket",
  });
  const edited = removePlanNode(withoutTicketLink, "second");
  await repository.save({ ...opened, ...edited }, false);
  const reopened = await new AgentPlanRepository(database.asDatabase()).find(
    "kept",
  );
  expect(reopened?.revision).toBe(4);
  expect(reopened?.nodes.map((node) => node.id)).toEqual([
    "start",
    "first",
    "end",
    "ticket",
  ]);
  expect(reopened?.nodes.find((node) => node.id === "first")).toMatchObject({
    bindings: {},
  });
  expect(reopened?.edges).toEqual([{ from: "start", to: "first", ...FLOW }]);
});

it("lets the owner delete a plan, which then no longer appears in the plan list", async () => {
  database.rejections = ["deleted", "kept"];
  await repository.remove("deleted", "owner");
  const listed = await repository.list();
  expect(listed.map((entry) => entry.id)).toEqual(["kept"]);
  expect(database.rejections).toEqual(["kept"]);
});

it("keeps the plan and its refusals if the deletion journal fails", async () => {
  database.rejections = ["deleted", "kept"];
  await expect(
    repository.remove("deleted", "owner", {
      revision: 3,
      journal: async () => {
        throw new Error("synthetic journal failure");
      },
    }),
  ).rejects.toThrow("synthetic journal failure");
  expect((await repository.find("deleted"))?.id).toBe("deleted");
  expect(database.rejections).toEqual(["deleted", "kept"]);
});

it("refuses deletion by anyone but the owner and keeps the plan listed", async () => {
  await expect(repository.remove("deleted", "reader")).rejects.toEqual(
    new AgentError("plan_access_denied"),
  );
  expect((await repository.list()).map((entry) => entry.id)).toEqual([
    "deleted",
    "kept",
  ]);
});

it("refuses deletion while a run of the plan is running or paused", async () => {
  database.runs.push({ planId: "deleted", status: "paused" });
  await expect(repository.remove("deleted", "owner")).rejects.toEqual(
    new AgentError("plan_running"),
  );
  database.runs = [{ planId: "deleted", status: "succeeded" }];
  await repository.remove("deleted", "owner");
  expect((await repository.list()).map((entry) => entry.id)).toEqual(["kept"]);
});
