import { expect, it } from "vitest";

import { planLoopStages } from "@/definition/AgentPlanLoopStages";

import { agent, loopOf, planOf } from "./plan-fixtures";

it("groups loop members by flow depth and sorts concurrent nodes", () => {
  const edges = [
    { from: "a", to: "c", fromPort: "flow-out", toPort: "flow-in" },
    { from: "b", to: "c", fromPort: "flow-out", toPort: "flow-in" },
    { from: "c", to: "a", fromPort: "value-out", toPort: "event-in" },
  ];
  const loop = loopOf("loop", [agent("b"), agent("a"), agent("c")], edges);
  expect(planLoopStages(planOf([loop]), loop)).toEqual([["a", "b"], ["c"]]);
});

it("returns no stages for an empty loop", () => {
  const loop = loopOf("loop", []);
  expect(planLoopStages(planOf([loop]), loop)).toEqual([]);
});
