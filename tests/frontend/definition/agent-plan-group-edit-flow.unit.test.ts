import { describe, expect, it } from "vitest";

import {
  bindPlanParameter,
  connectPlanFlow,
  disconnectPlanGroupFlow,
  ungroupPlanGroup,
  withExplicitGroupFlow,
  withInternalGroupEdges,
} from "@/definition/AgentPlanGroupEdit";

import {
  TEXT_HELLO,
  decision,
  groupIn,
  member,
  nodeOf,
  pairs,
  stepIds,
} from "./group-edit-fixtures";
import { edge, groupOf, loopOf, planOf, script } from "./plan-fixtures";

import type {
  AgentPlanBinding,
  AgentPlanInput,
  AgentPlanNode,
} from "@/definition/AgentPlan";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";

describe("removing a frame and keeping its members", () => {
  const positionOf = (step: {
    readonly id: string;
  }): { x: number; y: number } => ({
    x: step.id.length * 100,
    y: 7,
  });

  it("leaves a plan without the group unchanged", () => {
    const plan = planOf([member("a")]);

    expect(ungroupPlanGroup(plan, "none", positionOf).plan).toBe(plan);
  });

  it("turns the members and decisions into outer nodes and joins the outer edges to entry and exit", () => {
    const group: AgentPlanGroup = {
      ...groupOf("g", [member("first"), member("second")]),
      decisions: [decision("d")],
      edges: [edge("first", "second")],
    };
    const plan = planOf(
      [member("before"), group, member("after")],
      [edge("before", "g"), edge("g", "after")],
    );

    const move = ungroupPlanGroup(plan, "g", positionOf);

    expect(move.plan.nodes.map((node) => node.id)).toEqual([
      "before",
      "after",
      "first",
      "second",
      "d",
    ]);
    expect(nodeOf(move.plan, "second")).toMatchObject({ x: 600, y: 7 });
    expect(nodeOf(move.plan, "d")).toMatchObject({ x: 100, y: 7 });
    expect(pairs(move.plan.edges)).toEqual([
      "before>first",
      "second>after",
      "first>second",
    ]);
    expect([move.removedEdges, move.removedBindings]).toEqual([0, 0]);
  });

  it("resolves the alias bindings of members before they leave", () => {
    const aliased = member("a", "codex", {
      topic: { kind: "source", nodeId: "port" },
    });
    const group: AgentPlanGroup = {
      ...groupOf("g", [aliased]),
      parameters: [
        {
          id: "port",
          name: "topic",
          type: "text",
          description: "",
          isRequired: false,
          defaultValue: null,
        },
      ],
      bindings: { topic: TEXT_HELLO },
    };

    const move = ungroupPlanGroup(planOf([group]), "g", positionOf);

    expect(nodeOf(move.plan, "a")).toMatchObject({
      bindings: { topic: TEXT_HELLO },
    });
  });

  it("keeps the plan when an alias cannot be resolved without ambiguity", () => {
    const port = {
      name: "topic",
      type: "text" as const,
      description: "",
      isRequired: false,
      defaultValue: null,
    };
    const group: AgentPlanGroup = {
      ...groupOf("g", [
        member("a", "codex", { topic: { kind: "source", nodeId: "one" } }),
      ]),
      parameters: [
        { ...port, id: "one" },
        { ...port, id: "two" },
      ],
    };
    const plan = planOf([group]);

    expect(ungroupPlanGroup(plan, "g", positionOf).plan).toBe(plan);
  });

  it("keeps the plan when an outer edge meets several entries or several exits", () => {
    const group: AgentPlanGroup = {
      ...groupOf("g", [member("a"), member("b")]),
      edges: [],
    };
    const entering = planOf([member("x"), group], [edge("x", "g")]);
    const leaving = planOf([group, member("y")], [edge("g", "y")]);

    expect(ungroupPlanGroup(entering, "g", positionOf).plan).toBe(entering);
    expect(ungroupPlanGroup(leaving, "g", positionOf).plan).toBe(leaving);
  });
});

describe("connecting flow between nodes", () => {
  const FLOW = { fromPort: "flow-out", toPort: "flow-in" };
  const link = (
    from: string,
    to: string,
  ): { from: string; to: string; fromPort: string; toPort: string } => ({
    from,
    to,
    ...FLOW,
  });

  it("adds an outer edge between outer nodes and between different frames", () => {
    const plan = planOf([
      member("a"),
      member("b"),
      groupOf("g", [member("in-g")]),
      groupOf("h", [member("in-h")]),
    ]);

    expect(connectPlanFlow(plan, "a", "b")).toMatchObject({
      edges: [link("a", "b")],
    });
    expect(connectPlanFlow(plan, "in-g", "in-h")).toMatchObject({
      edges: [link("in-g", "in-h")],
    });
    expect(connectPlanFlow(plan, "a", "in-g")).toMatchObject({
      edges: [link("a", "in-g")],
    });
  });

  it("refuses an endpoint that is a frame", () => {
    const plan = planOf([member("a"), groupOf("g", [member("in-g")])]);

    expect(connectPlanFlow(plan, "a", "g")).toBe("groupBoundary");
    expect(connectPlanFlow(plan, "g", "in-g")).toBe("groupBoundary");
  });

  it("keeps the edge between two members of one group inside the group", () => {
    const group: AgentPlanGroup = {
      ...groupOf("g", [member("a"), member("b")]),
      decisions: [decision("d")],
      edges: [],
    };
    const plan = planOf([group]);

    const joined = connectPlanFlow(plan, "a", "b");
    const withDecision = connectPlanFlow(plan, "a", "d");

    if (typeof joined === "string" || typeof withDecision === "string")
      throw new Error("Refused");
    expect(pairs(groupIn(joined, "g").edges)).toEqual(["a>b"]);
    expect(pairs(joined.edges)).toEqual([]);
    expect(pairs(groupIn(withDecision, "g").edges)).toEqual(["a>d"]);
  });

  it("lets a stack join anything as an outer edge, even a member of a loop", () => {
    const stack: AgentPlanNode = {
      id: "st",
      type: "stack",
      name: "Stack",
      entries: [],
      x: 0,
      y: 0,
    };
    const plan = planOf([stack, loopOf("l", [member("m")]), member("a")]);

    expect(connectPlanFlow(plan, "st", "m")).toMatchObject({
      edges: [link("st", "m")],
    });
    expect(connectPlanFlow(plan, "a", "st")).toMatchObject({
      edges: [link("a", "st")],
    });
  });
});

describe("connecting flow inside loops", () => {
  const FLOW = { fromPort: "flow-out", toPort: "flow-in" };

  it("keeps an edge between two members of one loop in the loop", () => {
    const plan = planOf([loopOf("l", [member("a"), script("s")]), member("x")]);

    const result = connectPlanFlow(plan, "a", "s");

    expect(result).toMatchObject({
      nodes: [{ id: "l", edges: [{ from: "a", to: "s", ...FLOW }] }, {}],
      edges: [],
    });
  });

  it("keeps an edge between two agents of one group of a loop in that group", () => {
    const group: AgentPlanGroup = {
      ...groupOf("lg", [member("a"), member("b")]),
      edges: [],
    };
    const plan = planOf([loopOf("l", [group, member("c")])]);

    const inGroup = connectPlanFlow(plan, "a", "b");
    const acrossGroups = connectPlanFlow(plan, "b", "c");

    expect(inGroup).toMatchObject({
      nodes: [
        {
          id: "l",
          edges: [],
          steps: [{ edges: [{ from: "a", to: "b" }] }, {}],
        },
      ],
    });
    expect(acrossGroups).toMatchObject({
      nodes: [{ id: "l", edges: [{ from: "b", to: "c", ...FLOW }] }],
    });
  });

  it("refuses an edge that joins a loop member to anything outside the loop", () => {
    const plan = planOf([
      loopOf("l", [member("a")]),
      loopOf("other", [member("o")]),
      member("x"),
    ]);

    expect(connectPlanFlow(plan, "a", "x")).toBe("loopBoundary");
    expect(connectPlanFlow(plan, "x", "a")).toBe("loopBoundary");
    expect(connectPlanFlow(plan, "a", "o")).toBe("loopBoundary");
  });
});

describe("removing flow from a group", () => {
  const group: AgentPlanGroup = {
    ...groupOf("g", [member("a"), member("b"), member("c")]),
    edges: [edge("a", "b"), edge("b", "c")],
  };

  it("removes one internal edge of a group and keeps both members", () => {
    const plan = planOf([group, groupOf("other", [member("x"), member("y")])]);

    const result = disconnectPlanGroupFlow(plan, "g", { from: "a", to: "b" });

    expect(pairs(groupIn(result, "g").edges)).toEqual(["b>c"]);
    expect(stepIds(groupIn(result, "g"))).toEqual(["a", "b", "c"]);
    expect(nodeOf(result, "other")).toBe(nodeOf(plan, "other"));
  });

  it("removes the edge of a group inside a loop and reads a legacy group as its chain", () => {
    const legacy = groupOf("lg", [member("p"), member("q")]);
    const plan = planOf([loopOf("l", [legacy, member("m")]), member("top")]);

    const result = disconnectPlanGroupFlow(plan, "lg", { from: "p", to: "q" });

    expect(result.nodes[0]).toMatchObject({
      steps: [{ id: "lg", edges: [] }, { id: "m" }],
    });
    expect(nodeOf(result, "top")).toBe(nodeOf(plan, "top"));
  });

  it("changes nothing when the edge does not exist", () => {
    const result = disconnectPlanGroupFlow(planOf([group]), "g", {
      from: "c",
      to: "a",
    });

    expect(pairs(groupIn(result, "g").edges)).toEqual(["a>b", "b>c"]);
  });
});

describe("giving older groups explicit flow", () => {
  it("returns the plan itself when every group has edges", () => {
    const plan = planOf([
      { ...groupOf("g", [member("a")]), edges: [] },
      member("b"),
    ]);

    expect(withExplicitGroupFlow(plan)).toBe(plan);
  });

  it("turns the member order of an older group into a chain and lays the members out in a row", () => {
    const plan = planOf([
      groupOf("old", [member("a"), member("b"), member("c")]),
      { ...groupOf("new", [member("d")]), edges: [] },
    ]);

    const result = withExplicitGroupFlow(plan);

    expect(pairs(groupIn(result, "old").edges)).toEqual(["a>b", "b>c"]);
    expect(groupIn(result, "old").steps.map((step) => step.x)).toEqual([
      0, 320, 640,
    ]);
    expect(nodeOf(result, "new")).toBe(nodeOf(plan, "new"));
  });
});

describe("binding an input", () => {
  it("binds an agent, an agent of a group and a script of a loop", () => {
    const plan = planOf([
      member("a"),
      groupOf("g", [member("in-group")]),
      loopOf("l", [script("loop-script")]),
    ]);

    const bound = (id: string): AgentPlanInput =>
      bindPlanParameter(plan, id, "topic", TEXT_HELLO);

    expect(nodeOf(bound("a"), "a")).toMatchObject({
      bindings: { topic: TEXT_HELLO },
    });
    expect(groupIn(bound("in-group"), "g").steps[0]).toMatchObject({
      bindings: { topic: TEXT_HELLO },
    });
    expect(nodeOf(bound("loop-script"), "l")).toMatchObject({
      steps: [{ bindings: { topic: TEXT_HELLO } }],
    });
  });

  it("adds the binding to the ones a node already has and replaces the same input", () => {
    const first: AgentPlanBinding = { kind: "result", stepId: "x" };
    const plan = planOf([member("a", "codex", { keep: first, topic: first })]);

    expect(
      nodeOf(bindPlanParameter(plan, "a", "topic", TEXT_HELLO), "a"),
    ).toMatchObject({
      bindings: { keep: first, topic: TEXT_HELLO },
    });
  });

  it("leaves the plan unchanged for a node that takes no inputs", () => {
    const plan = planOf([member("a")]);

    expect(bindPlanParameter(plan, "nowhere", "topic", TEXT_HELLO)).toBe(plan);
  });
});

describe("keeping member edges in their group", () => {
  it("returns the plan itself without a group or without an edge between members", () => {
    const plain = planOf([member("a"), member("b")], [edge("a", "b")]);
    const crossing = planOf(
      [groupOf("g", [member("a")]), member("b")],
      [edge("a", "b")],
    );

    expect(withInternalGroupEdges(plain)).toBe(plain);
    expect(withInternalGroupEdges(crossing)).toBe(crossing);
  });

  it("moves edges between members of one group out of the outer graph and keeps the others", () => {
    const plan = planOf(
      [
        { ...groupOf("g", [member("a"), member("b")]), edges: [] },
        {
          ...groupOf("h", [member("c"), member("d")]),
          edges: [edge("c", "d")],
        },
        member("x"),
      ],
      [edge("a", "b"), edge("b", "x"), edge("d", "c")],
    );

    const result = withInternalGroupEdges(plan);

    expect(pairs(result.edges)).toEqual(["b>x"]);
    expect(pairs(groupIn(result, "g").edges)).toEqual(["a>b"]);
    expect(pairs(groupIn(result, "h").edges)).toEqual(["c>d", "d>c"]);
    expect(nodeOf(result, "x")).toBe(nodeOf(plan, "x"));
  });
});
