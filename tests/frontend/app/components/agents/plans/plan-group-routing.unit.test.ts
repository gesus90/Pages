import { expect, it } from "vitest";

import {
  planGroupRouteLabel,
  planGroupRouteLinks,
} from "@/app/components/agents/plans/plan-group-routing";

import {
  agentNode,
  flowEdge,
  planOf,
  sessionGroup,
} from "./plan-group-fixture";

import type { AgentPlanInput } from "@/definition/AgentPlan";

const GROUP = sessionGroup({
  steps: [agentNode("m1", "codex"), agentNode("m2", "codex")],
  edges: [flowEdge("m1", "m2")],
});

/** Two outer agents flow into the group's members, one member flows out to a third. */
function routedPlan(): AgentPlanInput {
  return planOf(
    [
      agentNode("in1", "codex"),
      agentNode("in2", "codex"),
      GROUP,
      agentNode("out", "codex"),
      agentNode("aside", "codex"),
    ],
    [
      flowEdge("in1", "m1"),
      flowEdge("in2", "m2"),
      flowEdge("m2", "out"),
      flowEdge("in1", "aside"),
    ],
  );
}

it("lists only the links that cross the group boundary, optionally from one side", () => {
  const plan = routedPlan();
  expect(planGroupRouteLinks(plan, GROUP)).toEqual([
    { kind: "flow", from: "in1", to: "m1" },
    { kind: "flow", from: "in2", to: "m2" },
    { kind: "flow", from: "m2", to: "out" },
  ]);
  expect(planGroupRouteLinks(plan, GROUP, "to")).toEqual([
    { kind: "flow", from: "in1", to: "m1" },
    { kind: "flow", from: "in2", to: "m2" },
  ]);
  expect(planGroupRouteLinks(plan, GROUP, "from")).toEqual([
    { kind: "flow", from: "m2", to: "out" },
  ]);
});

it("adds no label metadata while no group is collapsed or the link stays outside", () => {
  const plan = routedPlan();
  const outside = { kind: "flow", from: "in1", to: "aside" } as const;
  expect(planGroupRouteLabel(plan, outside, new Set())).toEqual({});
  expect(planGroupRouteLabel(plan, outside, new Set(["group"]))).toEqual({});
  // A link into an expanded group keeps its own label too.
  expect(
    planGroupRouteLabel(
      plan,
      { kind: "flow", from: "in1", to: "m1" },
      new Set(["other"]),
    ),
  ).toEqual({});
});

it("spreads the labels of a collapsed group's incoming links around its middle", () => {
  const plan = routedPlan();
  const collapsed = new Set(["group"]);
  const first = planGroupRouteLabel(
    plan,
    { kind: "flow", from: "in1", to: "m1" },
    collapsed,
  );
  const second = planGroupRouteLabel(
    plan,
    { kind: "flow", from: "in2", to: "m2" },
    collapsed,
  );
  // Anchors at 1/3 and 2/3 of the 115 px frame, labels 24 px apart around 57.5 px.
  expect(first.routeEnd).toBe("to");
  expect(first.routeLabelOffsetY).toBeCloseTo(45.5 - 115 / 3);
  expect(second.routeEnd).toBe("to");
  expect(second.routeLabelOffsetY).toBeCloseTo(69.5 - (2 * 115) / 3);
});

it("puts the single outgoing link of a collapsed group level with its anchor", () => {
  expect(
    planGroupRouteLabel(
      routedPlan(),
      { kind: "flow", from: "m2", to: "out" },
      new Set(["group"]),
    ),
  ).toEqual({ routeEnd: "from", routeLabelOffsetY: 0 });
});
