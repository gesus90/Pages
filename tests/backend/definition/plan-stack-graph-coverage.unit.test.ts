import { expect, it } from "vitest";

import {
  fitsPlanStackOutput,
  planStackIssues,
} from "@/definition/AgentPlanStackGraph";
import { emptyPlanStack } from "@/definition/AgentPlanStack";

import { agent, planOf } from "./plan-fixtures";

const STACK = {
  ...emptyPlanStack("stack", "Work", { x: 0, y: 0 }),
  entries: [{ id: "ticket", type: "task" as const, taskId: "T1" }],
};

it("matches stack content and counts to compatible parameter types", () => {
  expect(fitsPlanStackOutput(STACK, "content", "ticket")).toBe(true);
  expect(fitsPlanStackOutput(STACK, "content", "text")).toBe(true);
  expect(fitsPlanStackOutput(STACK, "content", "number")).toBe(false);
  expect(fitsPlanStackOutput(STACK, "count", "number")).toBe(true);
  expect(fitsPlanStackOutput(STACK, "count", "ticket")).toBe(false);
  expect(fitsPlanStackOutput(undefined, "count", "number")).toBe(false);
});

it("reports invalid entries, names and unordered stack readers", () => {
  const stack = {
    ...STACK,
    name: " ",
    entries: [{ id: "entry", type: "task" as const, taskId: "" }],
  };
  const reader = agent("reader", {
    value: { kind: "stack", stackId: "stack", output: "content" },
  });
  const plan = planOf([stack, reader]);
  expect(planStackIssues(plan, plan)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ nodeId: "stack", reason: "name" }),
      expect.objectContaining({ nodeId: "stack", reason: "stackEntries" }),
      expect.objectContaining({ nodeId: "reader", reason: "stackOrder" }),
    ]),
  );
  expect(planStackIssues(planOf([]), planOf([]))).toEqual([]);
});
