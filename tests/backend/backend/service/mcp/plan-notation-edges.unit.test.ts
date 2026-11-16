import { expect, it } from "vitest";

import { applyPlanNotationEdge } from "@/backend/service/mcp/plan/PlanNotationEdges";

import {
  AGENTS,
  decision,
  member,
} from "../../../definition/group-edit-fixtures";
import { loopOf, planOf, script } from "../../../definition/plan-fixtures";

import type { AgentPlanInput } from "@/definition/AgentPlan";
import type {
  PlanNotationEdgeResult,
  PlanNotationEdgeSpec,
} from "@/backend/service/mcp/plan/PlanNotationEdges";

function connect(
  plan: AgentPlanInput,
  from: string,
  to: string,
  spec: PlanNotationEdgeSpec,
): PlanNotationEdgeResult {
  return applyPlanNotationEdge(plan, { from, to }, { spec, agents: AGENTS });
}

it("connects flow and branching, and rejects missing nodes or incompatible outputs", () => {
  const plan = planOf([member("a"), member("b"), decision("d")]);
  const flow = connect(plan, "a", "b", { isPrevious: false });
  expect(flow).toHaveProperty("plan.edges");
  expect(connect(plan, "missing", "b", { isPrevious: false })).toEqual({
    code: "unknown_node",
    nodeId: "missing",
  });
  expect(connect(plan, "a", "missing", { isPrevious: false })).toEqual({
    code: "unknown_node",
    nodeId: "missing",
  });
  expect(connect(plan, "a", "b", { isPrevious: true })).toEqual({
    code: "invalid_value",
    nodeId: "a",
  });
  expect(
    connect(plan, "a", "b", { branch: "true", isPrevious: false }),
  ).toEqual({ code: "unknown_port", nodeId: "a" });
  expect(connect(plan, "d", "b", { isPrevious: false })).toEqual({
    code: "unknown_port",
    nodeId: "d",
  });
  expect(
    connect(plan, "d", "b", { branch: "true", isPrevious: false }),
  ).toHaveProperty("plan");
});

it("connects condition and event wires while rejecting incompatible combinations", () => {
  const plan = planOf([
    member("a"),
    member("b"),
    decision("d"),
    script("script"),
  ]);
  expect(
    connect(plan, "a", "d", { input: "condition", isPrevious: false }),
  ).toHaveProperty("plan");
  expect(
    connect(plan, "a", "b", { input: "event", isPrevious: false }),
  ).toHaveProperty("plan");
  expect(
    connect(plan, "script", "b", { input: "event", isPrevious: false }),
  ).toEqual({ code: "unknown_port", nodeId: "script" });
  expect(
    connect(plan, "d", "b", { input: "event", isPrevious: false }),
  ).toEqual({ code: "unknown_port", nodeId: "d" });
  expect(
    connect(plan, "a", "b", { input: "condition", isPrevious: false }),
  ).toEqual({ code: "unknown_port", nodeId: "b" });
  expect(
    connect(plan, "a", "b", {
      input: "event",
      branch: "true",
      isPrevious: false,
    }),
  ).toEqual({ code: "invalid_value", nodeId: "a" });
});

it("binds loop counts from parameters and rejects invalid or duplicate data inputs", () => {
  const parameter = {
    id: "p",
    type: "parameter" as const,
    name: "Count",
    format: "number" as const,
    value: { type: "number" as const, number: 2 },
    x: 0,
    y: 0,
  };
  const plan = planOf([parameter, loopOf("loop", []), member("worker")]);
  const bound = connect(plan, "p", "loop", {
    input: "runs",
    isPrevious: false,
  });
  if (!("plan" in bound)) throw new Error("Missing bound plan");
  expect(bound.plan.nodes.find((node) => node.id === "loop")).toMatchObject({
    runsSource: "parameter",
  });
  expect(
    connect(bound.plan, "p", "loop", { input: "runs", isPrevious: false }),
  ).toEqual({ code: "duplicate_field", nodeId: "loop" });
  expect(
    connect(plan, "p", "loop", { input: "unknown", isPrevious: false }),
  ).toEqual({ code: "unknown_port", nodeId: "loop" });
  expect(
    connect(plan, "p", "worker", { input: "unknown", isPrevious: false }),
  ).toEqual({ code: "unknown_port", nodeId: "worker" });
});
