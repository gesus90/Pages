import { expect, it } from "vitest";

import {
  arePlanNodesOrdered,
  hasPlanReach,
  planBranchingExecutionIssues,
  planEdgeEndpointIssues,
  planEventOrderIssues,
} from "@/definition/AgentPlanBranchingGraph";
import { emptyAgentPlan } from "@/definition/AgentPlan";

const DECISION = {
  id: "decision",
  type: "decision" as const,
  x: 0,
  y: 0,
  mode: "model" as const,
  output: "classification" as const,
};

it("reports missing execution settings and outputs of a model decision", () => {
  const findings = planBranchingExecutionIssues({
    ...emptyAgentPlan(),
    nodes: [DECISION],
    edges: [],
  });
  expect(findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ reason: "decisionCondition" }),
      expect.objectContaining({ reason: "decisionQuestion" }),
      expect.objectContaining({ reason: "decisionModel" }),
      expect.objectContaining({ reason: "decisionCases" }),
    ]),
  );
});

it("checks both endpoints of a flow edge", () => {
  const edge = {
    from: "start",
    to: "end",
    fromPort: "flow-out",
    toPort: "flow-in",
  };
  const plan = {
    nodes: [
      { id: "start", type: "start" as const, x: 0, y: 0 },
      { id: "end", type: "end" as const, x: 0, y: 0 },
    ],
    edges: [edge],
  };
  expect(planEdgeEndpointIssues(plan, edge)).toEqual([]);
  expect(
    planEdgeEndpointIssues(plan, { ...edge, from: "missing", to: "unknown" }),
  ).toEqual([
    expect.objectContaining({ nodeId: "missing", reason: "port" }),
    expect.objectContaining({ nodeId: "unknown", reason: "port" }),
  ]);
});

it("orders nodes through paths and exclusive decision branches", () => {
  const edges = [
    { from: "decision", to: "yes", fromPort: "true-out", toPort: "flow-in" },
    { from: "decision", to: "no", fromPort: "false-out", toPort: "flow-in" },
    { from: "yes", to: "next", fromPort: "flow-out", toPort: "flow-in" },
  ];
  expect(arePlanNodesOrdered(edges, "yes", "next")).toBe(true);
  expect(arePlanNodesOrdered(edges, "yes", "no")).toBe(true);
  expect(arePlanNodesOrdered(edges, "yes", "missing")).toBe(false);
  expect(hasPlanReach(edges, "decision", "next")).toBe(true);
  expect(hasPlanReach(edges, "next", "decision")).toBe(false);
});

it("rejects an event that cannot return to an earlier node", () => {
  const edge = {
    from: "source",
    to: "target",
    fromPort: "value-out",
    toPort: "event-in",
  };
  expect(planEventOrderIssues({ edges: [edge] }, edge)).toEqual([
    expect.objectContaining({ nodeId: "target", reason: "eventOrder" }),
  ]);
});
