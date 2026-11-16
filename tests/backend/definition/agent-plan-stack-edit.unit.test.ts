import { expect, it } from "vitest";

import { PLAN_STACK_ENTRY_COUNT } from "@/definition/AgentPlanStack";
import {
  addPlanStackAsset,
  addPlanStackTicket,
  joinPlanStack,
  movePlanStackEntry,
  removePlanStackEntry,
} from "@/definition/AgentPlanStackEdit";

import { partial } from "../app/lib/service-wiring-fakes";
import { agent, edge, groupOf, loopOf, planOf } from "./plan-fixtures";

import type { AgentPlanAssetFile } from "@/definition/AgentPlanAsset";
import type { AgentPlanStack } from "@/definition/AgentPlanStack";

const STACK: AgentPlanStack = {
  id: "stack",
  type: "stack",
  name: "Stack",
  x: 0,
  y: 0,
  entries: [],
};

it("moves a ticket into a stack and removes its direct readers and edges", () => {
  const ticket = {
    id: "ticket",
    type: "task" as const,
    taskId: "task",
    x: 0,
    y: 0,
  };
  const binding = { input: { kind: "source" as const, nodeId: "ticket" } };
  const plan = planOf(
    [
      STACK,
      ticket,
      agent("outer", binding),
      groupOf("group", [agent("inner", binding)]),
      loopOf("loop", [agent("loop-worker", binding)]),
    ],
    [edge("ticket", "outer")],
  );
  const result = joinPlanStack(plan, "stack", "ticket");
  if (typeof result === "string") throw new Error(result);
  expect(result.removedBindings).toBe(3);
  expect(result.plan.edges).toEqual([]);
  expect(
    result.plan.nodes.find((node) => node.id === "ticket"),
  ).toBeUndefined();
  expect(result.plan.nodes.find((node) => node.id === "stack")).toMatchObject({
    entries: [{ id: "ticket", type: "task", taskId: "task" }],
  });
});

it("rejects missing or incompatible nodes and a full stack", () => {
  const plan = planOf([STACK, agent("agent")]);
  expect(joinPlanStack(plan, "missing", "agent")).toBe("missingStack");
  expect(joinPlanStack(plan, "stack", "agent")).toBe("notEntry");
  const full = {
    ...STACK,
    entries: Array.from({ length: PLAN_STACK_ENTRY_COUNT }, (_, index) => ({
      id: String(index),
      type: "task" as const,
      taskId: "task",
    })),
  };
  const parameter = {
    id: "p",
    type: "parameter" as const,
    name: "P",
    format: "string" as const,
    value: { type: "text" as const, text: "value" },
    x: 0,
    y: 0,
  };
  const fullPlan = planOf([full, parameter]);
  expect(joinPlanStack(fullPlan, "stack", "p")).toBe("full");
  expect(
    addPlanStackTicket(fullPlan, "stack", { id: "new", taskId: "task" }),
  ).toBe(fullPlan);
});

it("adds, reorders and removes stack entries", () => {
  const file = partial<AgentPlanAssetFile>({ assetId: "asset" });
  const plan = addPlanStackAsset(
    addPlanStackTicket(planOf([STACK]), "stack", {
      id: "ticket",
      taskId: "task",
    }),
    "stack",
    { id: "file", file },
  );
  const stack = plan.nodes.find(
    (node): node is AgentPlanStack => node.type === "stack",
  );
  if (!stack) throw new Error("Missing stack");
  expect(stack.entries.map((entry) => entry.id)).toEqual(["ticket", "file"]);
  const moved = movePlanStackEntry(stack, "file", -1);
  expect(moved.entries.map((entry) => entry.id)).toEqual(["file", "ticket"]);
  expect(movePlanStackEntry(moved, "file", -1)).toBe(moved);
  expect(
    removePlanStackEntry(moved, "file").entries.map((entry) => entry.id),
  ).toEqual(["ticket"]);
});
