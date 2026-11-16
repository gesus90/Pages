import { expect, it } from "vitest";

import {
  findPlanGroupLocation,
  placePlanGroupInLoop,
  ungroupPlanLoopGroup,
} from "@/definition/AgentPlanLoopGroupEdit";

import { agent, edge, groupOf, loopOf, planOf } from "./plan-fixtures";

it("moves a group into and out of a loop and keeps its members together", () => {
  const group = groupOf("group", [agent("a"), agent("b")]);
  const plan = planOf([group, loopOf("loop", [])]);
  const moved = placePlanGroupInLoop(plan, {
    groupId: "group",
    loopId: "loop",
    position: { x: 10, y: 20 },
  });
  if (typeof moved === "string") throw new Error(moved);
  expect(findPlanGroupLocation(moved.plan, "group")).toMatchObject({
    group: { x: 10, y: 20 },
    loop: { id: "loop" },
  });
  const returned = placePlanGroupInLoop(moved.plan, {
    groupId: "group",
    loopId: null,
    position: { x: 30, y: 40 },
  });
  if (typeof returned === "string") throw new Error(returned);
  expect(findPlanGroupLocation(returned.plan, "group")).toMatchObject({
    loop: null,
    group: { x: 30, y: 40 },
  });
  expect(findPlanGroupLocation(returned.plan, "missing")).toBeNull();
});

it("removes crossing result bindings and edges while retaining internal results", () => {
  const group = groupOf("group", [
    agent("a", {
      outside: { kind: "result", stepId: "outside" },
      inside: { kind: "result", stepId: "b" },
    }),
    agent("b"),
  ]);
  const outside = agent("outside", { result: { kind: "result", stepId: "a" } });
  const plan = planOf(
    [group, outside, loopOf("loop", [])],
    [edge("a", "outside")],
  );
  const moved = placePlanGroupInLoop(plan, {
    groupId: "group",
    loopId: "loop",
    position: { x: 0, y: 0 },
  });
  if (typeof moved === "string") throw new Error(moved);
  expect(moved).toMatchObject({ removedEdges: 1, removedBindings: 2 });
  expect(
    findPlanGroupLocation(moved.plan, "group")?.group.steps[0]?.bindings,
  ).toEqual({ inside: { kind: "result", stepId: "b" } });
  expect(moved.plan.nodes.find((node) => node.id === "outside")).toMatchObject({
    bindings: {},
  });
});

it("repositions a group, rejects absent targets and dissolves a loop group", () => {
  const group = {
    ...groupOf("group", [agent("a"), agent("b")]),
    edges: [edge("a", "b")],
  };
  const plan = planOf([loopOf("loop", [group])]);
  expect(
    placePlanGroupInLoop(plan, {
      groupId: "missing",
      loopId: null,
      position: { x: 0, y: 0 },
    }),
  ).toBe("missingAgent");
  expect(
    placePlanGroupInLoop(plan, {
      groupId: "group",
      loopId: "missing",
      position: { x: 0, y: 0 },
    }),
  ).toBe("missingAgent");
  const moved = placePlanGroupInLoop(plan, {
    groupId: "group",
    loopId: "loop",
    position: { x: 4, y: 5 },
  });
  if (typeof moved === "string") throw new Error(moved);
  expect(moved).toMatchObject({ removedEdges: 0, removedBindings: 0 });
  const ungrouped = ungroupPlanLoopGroup(moved.plan, "group", () => ({
    x: 6,
    y: 7,
  }));
  const loop = ungrouped.nodes.find((node) => node.id === "loop");
  expect(loop).toMatchObject({
    steps: [
      { id: "a", x: 6, y: 7 },
      { id: "b", x: 6, y: 7 },
    ],
    edges: [edge("a", "b")],
  });
  expect(
    ungroupPlanLoopGroup(ungrouped, "missing", () => ({ x: 0, y: 0 })),
  ).toBe(ungrouped);
});
