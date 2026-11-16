import { expect, it } from "vitest";

import {
  findPlanDecision,
  placePlanDecision,
  releasedPlanDecisions,
  replacePlanDecision,
  withPlanEdge,
  withoutPlanEdges,
} from "@/definition/AgentPlanDecisionEdit";

import { decision } from "./group-edit-fixtures";
import { agent, edge, groupOf, loopOf, planOf } from "./plan-fixtures";

it("finds and replaces decisions in top-level, group and loop locations", () => {
  const group = {
    ...groupOf("group", [agent("a")]),
    decisions: [decision("group-decision")],
  };
  const loop = {
    ...loopOf("loop", [agent("b")]),
    decisions: [decision("loop-decision")],
  };
  const plan = planOf([decision("top"), group, loop]);
  expect(findPlanDecision(plan, "top")?.place).toEqual({ kind: "top" });
  expect(findPlanDecision(plan, "group-decision")?.place).toEqual({
    kind: "group",
    groupId: "group",
  });
  expect(findPlanDecision(plan, "loop-decision")?.place).toEqual({
    kind: "loop",
    loopId: "loop",
  });
  expect(findPlanDecision(plan, "missing")).toBeNull();
  const replaced = replacePlanDecision(plan, {
    ...decision("loop-decision"),
    x: 10,
  });
  expect(findPlanDecision(replaced, "loop-decision")?.decision.x).toBe(10);
  expect(
    releasedPlanDecisions([decision("top")], { x: 2, y: 3 }),
  ).toMatchObject([{ x: 2, y: 3 }]);
});

it("moves a decision into a group while retaining a compatible outer flow", () => {
  const flow = {
    ...edge("outside", "d"),
    fromPort: "flow-out",
    toPort: "flow-in",
  };
  const plan = planOf(
    [agent("outside"), decision("d"), groupOf("group", [agent("a")])],
    [flow],
  );
  const moved = placePlanDecision(plan, {
    decisionId: "d",
    frameId: "group",
    position: { x: 4, y: 5 },
  });
  expect(moved?.removedEdges).toBe(0);
  expect(moved?.plan.edges).toContainEqual(flow);
  if (!moved) throw new Error("Missing move");
  expect(findPlanDecision(moved.plan, "d")).toMatchObject({
    place: { kind: "group", groupId: "group" },
    decision: { x: 4, y: 5 },
  });
  const back = placePlanDecision(moved.plan, {
    decisionId: "d",
    frameId: null,
    position: { x: 0, y: 0 },
  });
  expect(back && findPlanDecision(back.plan, "d")?.place).toEqual({
    kind: "top",
  });
});

it("drops edges crossing a loop boundary and refuses absent destinations", () => {
  const flow = {
    ...edge("outside", "d"),
    fromPort: "flow-out",
    toPort: "flow-in",
  };
  const plan = planOf(
    [agent("outside"), decision("d"), loopOf("loop", [])],
    [flow],
  );
  const moved = placePlanDecision(plan, {
    decisionId: "d",
    frameId: "loop",
    position: { x: 1, y: 1 },
  });
  expect(moved).toMatchObject({ removedEdges: 1, plan: { edges: [] } });
  expect(
    placePlanDecision(plan, {
      decisionId: "missing",
      frameId: null,
      position: { x: 0, y: 0 },
    }),
  ).toBeNull();
  expect(
    placePlanDecision(plan, {
      decisionId: "d",
      frameId: "outside",
      position: { x: 0, y: 0 },
    }),
  ).toBeNull();
});

it("stores internal edges in their frame and removes matching edges everywhere", () => {
  const group = {
    ...groupOf("group", [agent("a")]),
    decisions: [decision("d")],
  };
  const plan = planOf([group, agent("outside")]);
  const internal = edge("a", "d");
  const external = edge("d", "outside");
  const connected = withPlanEdge(withPlanEdge(plan, internal), external);
  expect(connected.nodes[0]).toMatchObject({ edges: [internal] });
  expect(connected.edges).toEqual([external]);
  const cleaned = withoutPlanEdges(
    connected,
    (item) => item.from === "d" || item.to === "d",
  );
  expect(cleaned.nodes[0]).toMatchObject({ edges: [] });
  expect(cleaned.edges).toEqual([]);
});
