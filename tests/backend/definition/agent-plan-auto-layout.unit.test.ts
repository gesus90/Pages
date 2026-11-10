import { describe, expect, it } from "vitest";

import {
  layoutPlan,
  PlanLayoutOverflowError,
} from "@/definition/AgentPlanAutoLayout";

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
  AgentPlanEdge,
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanPosition,
  AgentPlanSources,
} from "@/definition/AgentPlan";
import type { PlanRankDirection } from "@/definition/AgentPlanAutoLayout";

const SOURCES: AgentPlanSources = { agents: [], tasks: [] };
const AGENT_WIDTH = 320;
const AGENT_HEIGHT = 336;
const ENDPOINT_WIDTH = 160;
const ENDPOINT_HEIGHT = 56;
const COORDINATE_LIMIT = 6000;

function parameter(id: string): AgentPlanNode {
  return {
    id,
    type: "parameter",
    name: id,
    format: "string",
    value: { type: "text", text: "text" },
    x: 0,
    y: 0,
  };
}

function stack(id: string): AgentPlanNode {
  return { id, type: "stack", name: id, entries: [], x: 0, y: 0 };
}

function at(
  plan: AgentPlanInput,
  id: string,
  container?: string,
): AgentPlanPosition {
  const members =
    container === undefined
      ? plan.nodes
      : (() => {
          const frame = plan.nodes.find((node) => node.id === container);
          if (frame?.type !== "group" && frame?.type !== "loop")
            throw new Error(`No frame ${container}`);
          return frame.steps;
        })();
  const member = members.find((entry) => entry.id === id);
  if (!member) throw new Error(`No node ${id}`);
  return { x: member.x, y: member.y };
}

function laidOut(
  nodes: AgentPlanInput["nodes"],
  edges: AgentPlanEdge[] = [],
  rankdir: PlanRankDirection = "TB",
  previous?: AgentPlanInput | null,
): AgentPlanInput {
  return layoutPlan(planOf(nodes, edges), SOURCES, { rankdir, previous });
}

function eventEdge(from: string, to: string): AgentPlanEdge {
  return { from, to, fromPort: "value-out", toPort: "event-in" };
}

function stored(
  nodes: AgentPlanInput["nodes"],
  edges: AgentPlanEdge[] = [],
): AgentPlanInput {
  return planOf(nodes, edges);
}

describe("layoutPlan ranks", () => {
  it("stacks a chain of nodes top to bottom, each rank centred on the widest card", () => {
    const plan = laidOut(
      [boundary("start", "start"), agent("a"), boundary("end", "end")],
      [edge("start", "a"), edge("a", "end")],
    );

    expect(at(plan, "start")).toEqual({ x: 40 + 80, y: 40 });
    expect(at(plan, "a")).toEqual({ x: 40, y: 40 + ENDPOINT_HEIGHT + 80 });
    expect(at(plan, "end")).toEqual({
      x: 40 + 80,
      y: 40 + ENDPOINT_HEIGHT + 80 + AGENT_HEIGHT + 80,
    });
  });

  it("lays ranks out from left to right for the LR direction", () => {
    const plan = laidOut(
      [boundary("start", "start"), agent("a"), boundary("end", "end")],
      [edge("start", "a"), edge("a", "end")],
      "LR",
    );

    expect(at(plan, "start")).toEqual({ x: 40, y: 40 + 140 });
    expect(at(plan, "a")).toEqual({ x: 40 + ENDPOINT_WIDTH + 80, y: 40 });
    expect(at(plan, "end")).toEqual({
      x: 40 + ENDPOINT_WIDTH + 80 + AGENT_WIDTH + 80,
      y: 40 + 140,
    });
  });

  it("keeps parallel branches in one rank, 40 px apart, in their stored order", () => {
    const plan = laidOut(
      [
        boundary("start", "start"),
        agent("b"),
        agent("a"),
        boundary("end", "end"),
      ],
      [
        edge("start", "a"),
        edge("start", "b"),
        edge("a", "end"),
        edge("b", "end"),
      ],
    );

    expect(at(plan, "b")).toEqual({ x: 40, y: 176 });
    expect(at(plan, "a")).toEqual({ x: 40 + AGENT_WIDTH + 40, y: 176 });
  });

  it("orders a rank by the barycenter of its predecessors", () => {
    const plan = laidOut(
      [
        boundary("start", "start"),
        agent("p"),
        agent("q"),
        agent("y"),
        agent("x"),
        boundary("end", "end"),
      ],
      [
        edge("start", "p"),
        edge("start", "q"),
        edge("p", "x"),
        edge("q", "y"),
        edge("x", "end"),
        edge("y", "end"),
      ],
    );

    expect(at(plan, "x").y).toBe(at(plan, "y").y);
    expect(at(plan, "x").x).toBeLessThan(at(plan, "y").x);
  });

  it("places a box without predecessors by its successors in the second pass", () => {
    const feeds = { input: { kind: "source", nodeId: "p" } } as const;
    const plan = laidOut(
      [
        parameter("p"),
        boundary("start", "start"),
        parameter("z"),
        agent("a"),
        {
          ...agent("b"),
          bindings: { ...feeds, other: { kind: "source", nodeId: "z" } },
        },
        boundary("end", "end"),
      ],
      [
        edge("start", "a"),
        edge("start", "b"),
        edge("a", "end"),
        edge("b", "end"),
      ],
    );

    expect(at(plan, "p").y).toBe(at(plan, "start").y);
    expect(at(plan, "start").x).toBeLessThan(at(plan, "p").x);
    expect(at(plan, "p").x).toBeLessThan(at(plan, "z").x);
  });
});

describe("layoutPlan cycles and stray edges", () => {
  it("breaks a cycle at the edge that leads back", () => {
    const plan = laidOut(
      [
        boundary("start", "start"),
        agent("a"),
        agent("b"),
        boundary("end", "end"),
      ],
      [edge("start", "a"), edge("a", "b"), edge("b", "a"), edge("b", "end")],
    );

    expect(at(plan, "start").y).toBeLessThan(at(plan, "a").y);
    expect(at(plan, "a").y).toBeLessThan(at(plan, "b").y);
    expect(at(plan, "b").y).toBeLessThan(at(plan, "end").y);
  });

  it("breaks a cycle that has no entry node", () => {
    const plan = laidOut(
      [agent("a"), agent("b")],
      [edge("a", "b"), edge("b", "a")],
    );

    expect(at(plan, "a").y).toBeLessThan(at(plan, "b").y);
  });

  it("ignores edges that name a node outside the level", () => {
    const plan = laidOut(
      [agent("a"), agent("b")],
      [edge("a", "ghost"), edge("ghost", "b")],
    );

    expect(at(plan, "a").y).toBe(at(plan, "b").y);
  });
});

describe("layoutPlan value sources", () => {
  it("lets an event edge order nothing", () => {
    const plan = laidOut(
      [boundary("start", "start"), agent("x"), agent("y")],
      [eventEdge("x", "y")],
    );

    expect(at(plan, "x").y).toBe(at(plan, "y").y);
  });

  it("places a value source one rank before its first target and starts ranks at 0", () => {
    const plan = laidOut([
      agent("a", { input: { kind: "source", nodeId: "p" } }),
      parameter("p"),
    ]);

    expect(at(plan, "p").y).toBe(40);
    expect(at(plan, "a").y).toBe(40 + 166 + 80);
  });

  it("places a source before the earliest of several targets", () => {
    const plan = laidOut(
      [
        boundary("start", "start"),
        agent("a"),
        agent("b"),
        parameter("p"),
        {
          ...script("s"),
          bindings: { input: { kind: "source", nodeId: "p" } },
        },
        {
          ...agent("late"),
          bindings: { input: { kind: "source", nodeId: "p" } },
        },
        boundary("end", "end"),
      ],
      [
        edge("start", "a"),
        edge("a", "b"),
        edge("b", "late"),
        edge("late", "end"),
        edge("start", "s"),
        edge("s", "end"),
      ],
    );

    expect(at(plan, "p").y).toBe(at(plan, "start").y);
  });

  it("reads result and stack bindings as value sources and a previous iteration as nothing", () => {
    const plan = laidOut(
      [
        boundary("start", "start"),
        agent("x"),
        agent("r"),
        stack("s"),
        {
          ...agent("c"),
          bindings: {
            first: { kind: "result", stepId: "r" },
            second: { kind: "stack", stackId: "s", output: "count" },
            third: { kind: "previous", stepId: "never" },
            fourth: { kind: "literal", value: { type: "text", text: "text" } },
          },
        },
        boundary("end", "end"),
      ],
      [edge("start", "x"), edge("x", "c"), edge("c", "end")],
    );

    expect(at(plan, "r").y).toBe(at(plan, "x").y);
    expect(at(plan, "s").y).toBe(at(plan, "x").y);
  });
});

describe("layoutPlan links between boxes", () => {
  it("does not let a data link replace the flow link between the same nodes", () => {
    const plan = laidOut(
      [
        boundary("start", "start"),
        agent("a"),
        { ...agent("b"), bindings: { input: { kind: "source", nodeId: "a" } } },
        boundary("end", "end"),
      ],
      [edge("start", "a"), edge("a", "b"), edge("b", "end")],
    );

    expect(at(plan, "a").y).toBeLessThan(at(plan, "b").y);
    expect(at(plan, "b").y).toBeLessThan(at(plan, "end").y);
  });

  it("takes a binding on a nested node as a link to the frame that holds it", () => {
    const inner = {
      ...agent("inner"),
      bindings: { input: { kind: "source", nodeId: "p" } },
    } as const;
    const plan = laidOut(
      [
        boundary("start", "start"),
        agent("x"),
        parameter("p"),
        groupOf("g", [inner]),
        boundary("end", "end"),
      ],
      [edge("start", "x"), edge("x", "g"), edge("g", "end")],
    );

    expect(at(plan, "p").y).toBe(at(plan, "x").y);
    expect(at(plan, "x").y).toBeLessThan(at(plan, "g").y);
  });

  it("ignores a binding between two members of the same frame at the outer level", () => {
    const first = agent("first");
    const second = {
      ...agent("second"),
      bindings: { input: { kind: "source", nodeId: "first" } },
    } as const;
    const plan = laidOut([groupOf("g", [first, second])]);

    expect(at(plan, "g")).toEqual({ x: 40, y: 40 });
    expect(at(plan, "first", "g")).toEqual({ x: 0, y: 0 });
    expect(at(plan, "second", "g")).toEqual({ x: 0, y: AGENT_HEIGHT + 80 });
  });

  it("returns an empty plan unchanged", () => {
    const plan = laidOut([]);

    expect(plan.nodes).toEqual([]);
  });
});

describe("layoutPlan frames", () => {
  it("reads a group without edges as the chain of its members", () => {
    const plan = laidOut([groupOf("g", [agent("one"), agent("two")])]);

    expect(at(plan, "one", "g")).toEqual({ x: 0, y: 0 });
    expect(at(plan, "two", "g")).toEqual({ x: 0, y: AGENT_HEIGHT + 80 });
  });

  it("follows the edges a group names over the order of its members", () => {
    const group = {
      ...groupOf("g", [agent("one"), agent("two")]),
      edges: [edge("two", "one")],
    };
    const plan = laidOut([group]);

    expect(at(plan, "two", "g").y).toBe(0);
    expect(at(plan, "one", "g").y).toBe(AGENT_HEIGHT + 80);
  });

  it("lays out a loop with its members and the groups inside it", () => {
    const loop = loopOf(
      "loop",
      [agent("a"), agent("b"), groupOf("inner", [agent("c")])],
      [edge("a", "b"), edge("b", "inner")],
    );
    const plan = laidOut(
      [boundary("start", "start"), loop, boundary("end", "end")],
      [edge("start", "loop"), edge("loop", "end")],
    );

    // The group is the widest card of its rank column, so the agents centre on it.
    expect(at(plan, "a", "loop")).toEqual({ x: 180, y: 0 });
    expect(at(plan, "b", "loop")).toEqual({ x: 180, y: AGENT_HEIGHT + 80 });
    expect(at(plan, "inner", "loop")).toEqual({
      x: 0,
      y: 2 * (AGENT_HEIGHT + 80),
    });
    const frame = plan.nodes.find((node) => node.id === "loop");
    const inner = frame?.type === "loop" ? frame.steps[2] : undefined;
    expect(inner?.type === "group" ? inner.steps[0] : null).toMatchObject({
      id: "c",
      x: 0,
      y: 0,
    });
    expect(at(plan, "start").y).toBeLessThan(at(plan, "loop").y);
    expect(at(plan, "loop").y).toBeLessThan(at(plan, "end").y);
  });

  it("keeps everything else of the plan and leaves the input untouched", () => {
    const input = planOf(
      [boundary("start", "start"), agent("a")],
      [edge("start", "a")],
    );
    const snapshot = structuredClone(input);

    const result = layoutPlan(input, SOURCES, { rankdir: "TB" });

    expect(input).toEqual(snapshot);
    expect(result).toMatchObject({
      name: "Plan",
      workspaceId: "workspace",
      usage: "private",
      globals: {},
      edges: input.edges,
    });
    expect(result.nodes.map((node) => node.id)).toEqual(["start", "a"]);
  });
});

describe("layoutPlan with a stored plan", () => {
  it("keeps the stored position of every node that stays and returns at once", () => {
    const previous = stored([
      { ...agent("a"), x: 700, y: 900 },
      { ...agent("b"), x: 20, y: 30 },
    ]);

    const plan = laidOut([agent("a"), agent("b")], [], "TB", previous);

    expect(at(plan, "a")).toEqual({ x: 700, y: 900 });
    expect(at(plan, "b")).toEqual({ x: 20, y: 30 });
  });

  it("treats a missing or null previous plan like a first layout", () => {
    const fresh = laidOut([agent("a")]);

    expect(laidOut([agent("a")], [], "TB", null)).toEqual(fresh);
    expect(at(fresh, "a")).toEqual({ x: 40, y: 40 });
  });

  it("places a new node below what stays for TB", () => {
    const previous = stored([{ ...agent("a"), x: 100, y: 100 }]);

    const plan = laidOut(
      [agent("a"), agent("b")],
      [edge("a", "b")],
      "TB",
      previous,
    );

    expect(at(plan, "a")).toEqual({ x: 100, y: 100 });
    expect(at(plan, "b")).toEqual({ x: 100, y: 100 + AGENT_HEIGHT + 80 });
  });

  it("places a new node beside what stays for LR", () => {
    const previous = stored([{ ...agent("a"), x: 100, y: 100 }]);

    const plan = laidOut(
      [agent("a"), agent("b")],
      [edge("a", "b")],
      "LR",
      previous,
    );

    expect(at(plan, "a")).toEqual({ x: 100, y: 100 });
    expect(at(plan, "b")).toEqual({ x: 100 + AGENT_WIDTH + 80, y: 100 });
  });

  it("falls back to the other side when the preferred one is out of the grid", () => {
    const previous = stored([{ ...agent("a"), x: 100, y: 5900 }]);

    const plan = laidOut(
      [agent("a"), agent("b")],
      [edge("a", "b")],
      "TB",
      previous,
    );

    expect(at(plan, "b")).toEqual({ x: 100 + AGENT_WIDTH + 80, y: 5900 });
  });

  it("falls back below when the side for LR is out of the grid", () => {
    const previous = stored([{ ...agent("a"), x: 5900, y: 100 }]);

    const plan = laidOut(
      [agent("a"), agent("b")],
      [edge("a", "b")],
      "LR",
      previous,
    );

    expect(at(plan, "b")).toEqual({ x: 5900, y: 100 + AGENT_HEIGHT + 80 });
  });
});

describe("layoutPlan refusals and frames of a stored plan", () => {
  it("refuses to cover a stored node when no side has room", () => {
    const previous = stored([{ ...agent("a"), x: 5900, y: 5900 }]);

    expect(() =>
      laidOut([agent("a"), agent("b")], [edge("a", "b")], "TB", previous),
    ).toThrow(PlanLayoutOverflowError);
    try {
      laidOut([agent("a"), agent("b")], [edge("a", "b")], "TB", previous);
    } catch (error) {
      expect(error).toBeInstanceOf(PlanLayoutOverflowError);
      expect((error as PlanLayoutOverflowError).containerId).toBeNull();
      expect((error as Error).name).toBe("PlanLayoutOverflowError");
      expect((error as Error).message).toBe(
        "The plan layout does not fit the coordinate limit.",
      );
    }
  });

  it("names the frame whose members do not fit", () => {
    const previous = stored([
      groupOf("g", [{ ...agent("kept"), x: 5900, y: 5900 }]),
    ]);

    try {
      laidOut(
        [groupOf("g", [agent("kept"), agent("fresh")])],
        [],
        "TB",
        previous,
      );
      expect.unreachable("The layout must refuse.");
    } catch (error) {
      expect(error).toBeInstanceOf(PlanLayoutOverflowError);
      expect((error as PlanLayoutOverflowError).containerId).toBe("g");
    }
  });

  it("keeps the stored position of a member inside its frame", () => {
    const previous = stored([
      groupOf("g", [{ ...agent("kept"), x: 30, y: 50 }]),
    ]);

    const plan = laidOut(
      [groupOf("g", [agent("kept"), agent("fresh")])],
      [],
      "TB",
      previous,
    );

    expect(at(plan, "kept", "g")).toEqual({ x: 30, y: 50 });
    expect(at(plan, "fresh", "g")).toEqual({
      x: 30,
      y: 50 + AGENT_HEIGHT + 80,
    });
  });

  it("lays a node out anew when it moved to another container", () => {
    const previous = stored([{ ...agent("a"), x: 500, y: 500 }]);

    const plan = laidOut([groupOf("g", [agent("a")])], [], "TB", previous);

    expect(at(plan, "a", "g")).toEqual({ x: 0, y: 0 });
    expect(at(plan, "g")).toEqual({ x: 40, y: 40 });
  });

  it("moves a frame that grew over its neighbour and keeps the neighbour", () => {
    const previous = stored([
      { ...groupOf("g", []), x: 40, y: 40 },
      { ...agent("o"), x: 40, y: 400 },
    ]);

    const plan = laidOut(
      [groupOf("g", [agent("s")]), agent("o")],
      [],
      "TB",
      previous,
    );

    expect(at(plan, "o")).toEqual({ x: 40, y: 400 });
    expect(at(plan, "g")).toEqual({ x: 40, y: 400 + AGENT_HEIGHT + 80 });
  });

  it("keeps a frame that grew when nothing stands in its way", () => {
    const previous = stored([
      { ...groupOf("g", []), x: 40, y: 40 },
      { ...agent("o"), x: 40, y: 700 },
    ]);

    const plan = laidOut(
      [groupOf("g", [agent("s")]), agent("o")],
      [],
      "TB",
      previous,
    );

    expect(at(plan, "g")).toEqual({ x: 40, y: 40 });
    expect(at(plan, "o")).toEqual({ x: 40, y: 700 });
  });
});

describe("layoutPlan wide levels", () => {
  function overlaps(
    first: AgentPlanPosition,
    second: AgentPlanPosition,
  ): boolean {
    return (
      first.x < second.x + AGENT_WIDTH &&
      second.x < first.x + AGENT_WIDTH &&
      first.y < second.y + AGENT_HEIGHT &&
      second.y < first.y + AGENT_HEIGHT
    );
  }

  function fanOut(count: number): {
    readonly nodes: AgentPlanNode[];
    readonly edges: AgentPlanEdge[];
  } {
    const ids = Array.from({ length: count }, (_, index) => `n${index}`);
    return {
      nodes: [
        boundary("start", "start"),
        ...ids.map((id) => agent(id)),
        boundary("end", "end"),
      ],
      edges: [
        ...ids.map((id) => edge("start", id)),
        ...ids.map((id) => edge(id, "end")),
      ],
    };
  }

  it("wraps a rank wider than the grid into lines without covering a card", () => {
    const { nodes, edges } = fanOut(25);

    const plan = laidOut(nodes, edges);
    const agents = plan.nodes.filter((node) => node.type === "agent");

    expect(agents).toHaveLength(25);
    const rows = new Set(agents.map((node) => node.y));
    expect(rows.size).toBe(2);
    for (const first of agents)
      for (const second of agents)
        if (first !== second) expect(overlaps(first, second)).toBe(false);
    for (const node of plan.nodes) {
      expect(node.x).toBeLessThanOrEqual(COORDINATE_LIMIT);
      expect(node.y).toBeLessThanOrEqual(COORDINATE_LIMIT);
    }
  });

  it("folds lines that pass the grid in the rank direction into a band beside the first", () => {
    const { nodes, edges } = fanOut(220);

    const plan = laidOut(nodes, edges);

    const end = at(plan, "end");
    expect(end.y).toBe(40);
    expect(end.x).toBeGreaterThan(5000);
    for (const node of plan.nodes) {
      expect(node.x).toBeLessThanOrEqual(COORDINATE_LIMIT);
      expect(node.y).toBeLessThanOrEqual(COORDINATE_LIMIT);
    }
    const agents = plan.nodes.filter((node) => node.type === "agent");
    for (const [index, first] of agents.entries())
      for (const second of agents.slice(index + 1))
        expect(overlaps(first, second)).toBe(false);
  });

  it("refuses a level that cannot fit the grid even folded", () => {
    const { nodes, edges } = fanOut(400);

    expect(() => laidOut(nodes, edges)).toThrow(PlanLayoutOverflowError);
  });
});
