import { expect, it } from "vitest";

import {
  planFrameMoveNeedsRepair,
  planFrameUngroupNeedsRepair,
} from "@/definition/AgentPlanFrameSafety";

import { agent, edge, groupOf, loopOf, planOf, script } from "./plan-fixtures";

it("requires repair before dissolving a connected or referenced frame", () => {
  const group = groupOf("group", [agent("member")]);
  expect(planFrameUngroupNeedsRepair(planOf([group]), "missing")).toBe(false);
  expect(planFrameUngroupNeedsRepair(planOf([group]), "group")).toBe(false);
  expect(
    planFrameUngroupNeedsRepair(
      planOf([group], [edge("group", "next")]),
      "group",
    ),
  ).toBe(true);
  expect(
    planFrameUngroupNeedsRepair(
      planOf([
        group,
        script("consumer", { value: { kind: "result", stepId: "group" } }),
      ]),
      "group",
    ),
  ).toBe(true);
});

it("protects previous-iteration bindings when dissolving a loop", () => {
  const loop = loopOf("loop", [
    script("step", { prior: { kind: "previous", stepId: "step" } }),
  ]);
  expect(planFrameUngroupNeedsRepair(planOf([loop]), "loop")).toBe(true);
});

it("requires repair when a move drops connections or a loop condition source", () => {
  const loop = loopOf("loop", [agent("member")], [], {
    condition: {
      isEnabled: true,
      sourceNodeId: "member",
      outputPath: "$.ok",
      operator: "equals",
      expected: { type: "boolean", value: true },
    },
  });
  const plan = planOf([loop]);
  expect(
    planFrameMoveNeedsRepair(plan, "member", null, {
      removedEdges: 1,
      removedBindings: 0,
    }),
  ).toBe(true);
  expect(
    planFrameMoveNeedsRepair(plan, "member", null, {
      removedEdges: 0,
      removedBindings: 0,
    }),
  ).toBe(true);
  expect(
    planFrameMoveNeedsRepair(plan, "member", "loop", {
      removedEdges: 0,
      removedBindings: 0,
    }),
  ).toBe(false);
  expect(
    planFrameMoveNeedsRepair(plan, "missing", null, {
      removedEdges: 0,
      removedBindings: 0,
    }),
  ).toBe(false);
});
