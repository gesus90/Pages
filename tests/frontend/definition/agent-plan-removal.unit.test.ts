import { describe, expect, it } from "vitest";

import { removePlanNode } from "@/definition/AgentPlanRemoval";

import {
  agent,
  boundary,
  edge,
  groupOf,
  loopOf,
  planOf,
  script,
} from "./plan-fixtures";

import type {
  AgentPlanBinding,
  AgentPlanDecision,
  AgentPlanNode,
} from "@/definition/AgentPlan";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";

const SOURCE: AgentPlanBinding = { kind: "source", nodeId: "gone" };
const RESULT: AgentPlanBinding = { kind: "result", stepId: "gone" };
const PREVIOUS: AgentPlanBinding = { kind: "previous", stepId: "gone" };
const STACK: AgentPlanBinding = {
  kind: "stack",
  stackId: "gone",
  output: "content",
};
const LITERAL: AgentPlanBinding = {
  kind: "literal",
  value: { type: "text", text: "keep" },
};
const OTHER: AgentPlanBinding = { kind: "source", nodeId: "other" };

function decision(id: string, input?: AgentPlanBinding): AgentPlanDecision {
  return { id, type: "decision", x: 0, y: 0, ...(input ? { input } : {}) };
}

function find(
  nodes: readonly AgentPlanNode[],
  id: string,
): AgentPlanNode | undefined {
  return nodes.find((node) => node.id === id);
}

function asGroup(node: AgentPlanNode | undefined): AgentPlanGroup {
  if (node?.type !== "group") throw new Error("not a group");
  return node;
}

function asLoop(node: AgentPlanNode | undefined): AgentPlanLoop {
  if (node?.type !== "loop") throw new Error("not a loop");
  return node;
}

describe("removing a top level node", () => {
  it("drops the node, its edges and every binding that reads it from agents, scripts and decisions", () => {
    const plan = planOf(
      [
        boundary("start", "start"),
        agent("gone"),
        agent("a", {
          source: SOURCE,
          result: RESULT,
          previous: PREVIOUS,
          stack: STACK,
          literal: LITERAL,
          other: OTHER,
        }),
        script("s", { source: SOURCE, other: OTHER }),
        decision("d-read", RESULT),
        decision("d-keep", OTHER),
        decision("d-none"),
        boundary("end", "end"),
      ],
      [edge("start", "gone"), edge("gone", "a"), edge("a", "end")],
    );

    const next = removePlanNode(plan, "gone");

    expect(next.nodes.map((node) => node.id)).toEqual([
      "start",
      "a",
      "s",
      "d-read",
      "d-keep",
      "d-none",
      "end",
    ]);
    expect(next.edges).toEqual([edge("a", "end")]);
    const kept = find(next.nodes, "a");
    expect(kept?.type === "agent" && Object.keys(kept.bindings)).toEqual([
      "literal",
      "other",
    ]);
    const scriptNode = find(next.nodes, "s");
    expect(scriptNode?.type === "script" && scriptNode.bindings).toEqual({
      other: OTHER,
    });
    expect(find(next.nodes, "d-read")).toEqual({
      ...decision("d-read"),
      input: undefined,
    });
    expect(find(next.nodes, "d-keep")).toEqual(decision("d-keep", OTHER));
    expect(find(next.nodes, "d-none")).toEqual(decision("d-none"));
    expect(plan.nodes).toHaveLength(8);
  });

  it("leaves a plan alone when nothing has the id, keeping nodes without bindings as they are", () => {
    const plan = planOf(
      [boundary("start", "start"), agent("a"), boundary("end", "end")],
      [edge("start", "a")],
    );

    const next = removePlanNode(plan, "missing");

    expect(next.nodes).toEqual(plan.nodes);
    expect(next.edges).toEqual(plan.edges);
  });
});

describe("removing a group", () => {
  it("removes its members and decisions together with every reference to them", () => {
    const group: AgentPlanGroup = {
      ...groupOf("g", [agent("m1"), agent("m2")]),
      decisions: [decision("gd")],
    };
    const plan = planOf(
      [
        group,
        agent("after", {
          one: { kind: "result", stepId: "m1" },
          two: { kind: "previous", stepId: "m2" },
          three: { kind: "source", nodeId: "gd" },
          four: OTHER,
        }),
      ],
      [edge("g", "after"), edge("m1", "after"), edge("after", "gd")],
    );

    const next = removePlanNode(plan, "g");

    expect(next.nodes.map((node) => node.id)).toEqual(["after"]);
    const after = find(next.nodes, "after");
    expect(after?.type === "agent" && after.bindings).toEqual({ four: OTHER });
    expect(next.edges).toEqual([]);
  });
});

describe("removing a member of a group", () => {
  it("removes the member with its internal edges and bindings and keeps the other members", () => {
    const group: AgentPlanGroup = {
      ...groupOf("g", [
        agent("m1"),
        agent("m2", { read: { kind: "result", stepId: "m1" }, other: OTHER }),
        agent("m3"),
      ]),
      edges: [edge("m1", "m2"), edge("m2", "m3"), edge("m3", "m3")],
    };
    const plan = planOf([group, agent("a")], [edge("a", "g")]);

    const next = removePlanNode(plan, "m1");

    const rest = asGroup(find(next.nodes, "g"));
    expect(rest.steps.map((step) => step.id)).toEqual(["m2", "m3"]);
    expect(rest.steps[0]?.bindings).toEqual({ other: OTHER });
    expect(rest.edges).toEqual([edge("m2", "m3"), edge("m3", "m3")]);
    expect(next.edges).toEqual([edge("a", "g")]);
  });

  it("reads the member chain of a legacy group without saved edges", () => {
    const legacy = groupOf("g", [agent("m1"), agent("m2"), agent("m3")]);

    const next = removePlanNode(planOf([legacy]), "m2");

    const rest = asGroup(find(next.nodes, "g"));
    expect(rest.steps.map((step) => step.id)).toEqual(["m1", "m3"]);
    expect(rest.edges).toEqual([]);
  });

  it("removes a decision of the group with its edges and clears the input of the others", () => {
    const group: AgentPlanGroup = {
      ...groupOf("g", [agent("m1")]),
      decisions: [
        decision("d1"),
        decision("d2", { kind: "result", stepId: "d1" }),
      ],
      edges: [edge("m1", "d1"), edge("d1", "d2")],
    };

    const next = removePlanNode(planOf([group]), "d1");

    const rest = asGroup(find(next.nodes, "g"));
    expect(rest.decisions?.map((entry) => entry.id)).toEqual(["d2"]);
    expect(rest.decisions?.[0]?.input).toBeUndefined();
    expect(rest.edges).toEqual([]);
  });

  it("leaves the edges of a group alone when the removed node is not a member", () => {
    const group: AgentPlanGroup = {
      ...groupOf("g", [agent("m1"), agent("m2")]),
      edges: [edge("m1", "m2")],
    };

    const next = removePlanNode(planOf([group, agent("a")]), "a");

    expect(asGroup(find(next.nodes, "g")).edges).toEqual([edge("m1", "m2")]);
  });

  it("keeps a group without decisions free of a decisions field", () => {
    const next = removePlanNode(
      planOf([groupOf("g", [agent("m1")]), agent("a")]),
      "a",
    );

    expect(asGroup(find(next.nodes, "g"))).not.toHaveProperty("decisions");
  });
});

describe("removing from a loop", () => {
  function loopPlan(): AgentPlanLoop {
    return loopOf(
      "l",
      [
        agent("m1"),
        agent("m2", { read: { kind: "result", stepId: "m1" }, other: OTHER }),
        {
          ...groupOf("lg", [
            agent("g1"),
            agent("g2", { read: { kind: "previous", stepId: "m1" } }),
          ]),
          edges: [edge("g1", "g2")],
        },
      ],
      [edge("m1", "m2"), edge("m2", "lg")],
      {
        decisions: [decision("ld", { kind: "result", stepId: "m1" })],
        condition: {
          isEnabled: true,
          sourceNodeId: "m1",
          outputPath: "$.end",
          operator: "equals",
          expected: { type: "boolean", value: true },
        },
        while: { sourceNodeId: "m1", outputPath: "$.go" },
        bindings: { runs: { kind: "result", stepId: "m1" }, other: OTHER },
      },
    );
  }

  it("removes a member with its edges, bindings, decision inputs and the sources of the end condition and while check", () => {
    const next = removePlanNode(planOf([loopPlan()]), "m1");

    const loop = asLoop(find(next.nodes, "l"));
    expect(loop.steps.map((step) => step.id)).toEqual(["m2", "lg"]);
    expect(loop.steps[0]?.bindings).toEqual({ other: OTHER });
    const innerGroup = loop.steps[1];
    expect(
      innerGroup?.type === "group" && innerGroup.steps[1]?.bindings,
    ).toEqual({});
    expect(loop.edges).toEqual([edge("m2", "lg")]);
    expect(loop.decisions?.[0]?.input).toBeUndefined();
    expect(loop.condition).toMatchObject({
      sourceNodeId: "",
      outputPath: "$.end",
    });
    expect(loop.while).toEqual({ sourceNodeId: "", outputPath: "$.go" });
    expect(loop.bindings).toEqual({ other: OTHER });
  });

  it("removes a group of the loop together with the agents inside it", () => {
    const next = removePlanNode(planOf([loopPlan()]), "lg");

    const loop = asLoop(find(next.nodes, "l"));
    expect(loop.steps.map((step) => step.id)).toEqual(["m1", "m2"]);
    expect(loop.edges).toEqual([edge("m1", "m2")]);
    expect(loop.condition?.sourceNodeId).toBe("m1");
  });

  it("removes the agent of a loop group through the references of the loop and keeps the rest of the group", () => {
    const next = removePlanNode(planOf([loopPlan()]), "g1");

    const loop = asLoop(find(next.nodes, "l"));
    expect(loop.steps.map((step) => step.id)).toEqual(["m1", "m2", "lg"]);
  });

  it("removes a decision of the loop and keeps the condition and while sources", () => {
    const next = removePlanNode(planOf([loopPlan()]), "ld");

    const loop = asLoop(find(next.nodes, "l"));
    expect(loop.decisions).toEqual([]);
    expect(loop.condition?.sourceNodeId).toBe("m1");
    expect(loop.while?.sourceNodeId).toBe("m1");
  });

  it("leaves a loop without condition and while alone when something else goes", () => {
    const plain = loopOf("l", [agent("m1")]);

    const next = removePlanNode(planOf([plain, agent("a")]), "a");

    const loop = asLoop(find(next.nodes, "l"));
    expect(loop.condition).toBeNull();
    expect(loop).not.toHaveProperty("while");
    expect(loop).not.toHaveProperty("decisions");
  });
});

describe("removing a loop", () => {
  it("removes its members, the agents of its groups and its decisions with every reference to them", () => {
    const loop = loopOf(
      "l",
      [agent("m1"), groupOf("lg", [agent("g1")])],
      [edge("m1", "lg")],
      { decisions: [decision("ld")] },
    );
    const plan = planOf(
      [
        loop,
        agent("after", {
          one: { kind: "result", stepId: "m1" },
          two: { kind: "previous", stepId: "g1" },
          three: { kind: "source", nodeId: "ld" },
          four: { kind: "source", nodeId: "lg" },
          five: OTHER,
        }),
      ],
      [edge("l", "after"), edge("m1", "after")],
    );

    const next = removePlanNode(plan, "l");

    expect(next.nodes.map((node) => node.id)).toEqual(["after"]);
    const after = find(next.nodes, "after");
    expect(after?.type === "agent" && after.bindings).toEqual({ five: OTHER });
    expect(next.edges).toEqual([]);
  });
});
