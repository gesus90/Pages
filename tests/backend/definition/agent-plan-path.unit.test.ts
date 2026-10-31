import { describe, expect, it } from "vitest";

import { hasPlanPath, planPredecessors } from "@/definition/AgentPlanPath";

import { edge } from "./plan-fixtures";

import type { AgentPlanEdge } from "@/definition/AgentPlan";

describe("the flow path between two nodes", () => {
  it("follows edges across several nodes in their direction only", () => {
    const edges = [edge("a", "b"), edge("b", "c"), edge("x", "b")];

    expect(hasPlanPath(edges, "a", "c")).toBe(true);
    expect(hasPlanPath(edges, "x", "c")).toBe(true);
    expect(hasPlanPath(edges, "c", "a")).toBe(false);
    expect(hasPlanPath(edges, "a", "x")).toBe(false);
  });

  it("finds no path from a node to itself unless it lies on a cycle", () => {
    expect(hasPlanPath([edge("a", "b")], "a", "a")).toBe(false);
    expect(hasPlanPath([edge("a", "b"), edge("b", "a")], "a", "a")).toBe(true);
  });

  it("ends on a cycle that does not reach the target", () => {
    const edges = [edge("a", "b"), edge("b", "a"), edge("b", "c")];

    expect(hasPlanPath(edges, "a", "z")).toBe(false);
    expect(hasPlanPath(edges, "a", "c")).toBe(true);
  });

  it("answers for the edges it is given, not for an earlier list", () => {
    const before: readonly AgentPlanEdge[] = [edge("a", "b")];
    const after: readonly AgentPlanEdge[] = [...before, edge("b", "c")];

    expect(hasPlanPath(before, "a", "c")).toBe(false);
    expect(hasPlanPath(after, "a", "c")).toBe(true);
    expect(hasPlanPath(before, "a", "c")).toBe(false);
  });

  it("notices an edge added to a list it has already been asked about", () => {
    const edges = [edge("a", "b")];

    expect(hasPlanPath(edges, "a", "c")).toBe(false);
    edges.push(edge("b", "c"));

    expect(hasPlanPath(edges, "a", "c")).toBe(true);
  });

  it("walks a long chain of edges without a deep call stack", () => {
    const edges = Array.from({ length: 5000 }, (_, index) =>
      edge(`n${index}`, `n${index + 1}`),
    );

    expect(hasPlanPath(edges, "n0", "n5000")).toBe(true);
    expect(hasPlanPath(edges, "n5000", "n0")).toBe(false);
  });
});

describe("the nodes before a node", () => {
  it("lists every node with a path to it and nothing else", () => {
    const edges = [
      edge("start", "a"),
      edge("start", "b"),
      edge("a", "c"),
      edge("b", "c"),
      edge("c", "end"),
    ];

    expect([...planPredecessors(edges, "c")].sort()).toEqual([
      "a",
      "b",
      "start",
    ]);
    expect([...planPredecessors(edges, "a")]).toEqual(["start"]);
    expect(planPredecessors(edges, "start").size).toBe(0);
  });

  it("names the node itself only when it lies on a cycle", () => {
    const chain = [edge("a", "b"), edge("b", "c")];
    const cycle = [...chain, edge("c", "b")];

    expect(planPredecessors(chain, "b").has("b")).toBe(false);
    expect(planPredecessors(cycle, "b").has("b")).toBe(true);
  });

  it("agrees with the path question for every pair of a branching plan", () => {
    const edges = [
      edge("s", "a"),
      edge("s", "b"),
      edge("a", "c"),
      edge("b", "c"),
      edge("c", "d"),
      edge("x", "d"),
    ];
    const nodes = ["s", "a", "b", "c", "d", "x"];

    for (const to of nodes) {
      const predecessors = planPredecessors(edges, to);
      for (const from of nodes)
        expect(predecessors.has(from)).toBe(hasPlanPath(edges, from, to));
    }
  });
});
