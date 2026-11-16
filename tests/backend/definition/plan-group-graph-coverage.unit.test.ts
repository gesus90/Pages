import { expect, it } from "vitest";

import {
  containerEdgeIssues,
  planGroupIssues,
} from "@/definition/AgentPlanGroupGraph";

import { agent, groupOf, planOf } from "./plan-fixtures";

it("finds boundary crossings, invalid ports, duplicate edges and cycles", () => {
  const flow = { from: "a", to: "b", fromPort: "flow-out", toPort: "flow-in" };
  const invalid = {
    from: "a",
    to: "b",
    fromPort: "value-out",
    toPort: "event-in",
  };
  const reverse = {
    from: "b",
    to: "a",
    fromPort: "flow-out",
    toPort: "flow-in",
  };
  expect(
    containerEdgeIssues(new Set(["a", "b"]), [flow, flow, invalid, reverse]),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ reason: "duplicate" }),
      expect.objectContaining({ reason: "port" }),
      expect.objectContaining({ reason: "cycle" }),
    ]),
  );
  expect(containerEdgeIssues(new Set(["a"]), [flow])).toEqual([
    expect.objectContaining({ nodeId: "b", reason: "groupBoundary" }),
  ]);
});

it("allows an empty group as a draft but requires a member to execute", () => {
  const group = groupOf("group", []);
  const plan = planOf([group]);
  expect(planGroupIssues(plan, [], false)).toEqual([]);
  expect(planGroupIssues(plan, [], true)).toEqual([
    expect.objectContaining({ nodeId: "group", reason: "groupSize" }),
  ]);
});

it("reports member identifiers duplicated at the outer level", () => {
  const group = groupOf("group", [agent("same")]);
  const plan = planOf([group, agent("same")]);
  expect(planGroupIssues(plan, [], false)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ nodeId: "same", reason: "duplicateNode" }),
    ]),
  );
});
