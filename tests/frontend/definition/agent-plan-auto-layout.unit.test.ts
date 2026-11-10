import { describe, expect, it } from "vitest";

import {
  PlanLayoutOverflowError,
  layoutPlan,
} from "@/definition/AgentPlanAutoLayout";
import { planNodeHeight, planNodeWidth } from "@/definition/AgentPlanNodeSize";

import {
  agent,
  boundary,
  edge,
  groupOf,
  loopOf,
  planOf,
} from "./plan-fixtures";

import type {
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanSources,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { PlanRankDirection } from "@/definition/AgentPlanAutoLayout";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";

const SOURCES: AgentPlanSources = { agents: [], tasks: [] };

const AGENT_WIDTH = 320;
const AGENT_HEIGHT = 336;
const BOUNDARY_WIDTH = 160;
const BOUNDARY_HEIGHT = 56;

function parameter(id: string): AgentPlanNode {
  return {
    id,
    type: "parameter",
    name: id,
    format: "string",
    value: { type: "text", text: "" },
    x: 0,
    y: 0,
  };
}

function layout(
  plan: AgentPlanInput,
  rankdir: PlanRankDirection = "TB",
  previous?: AgentPlanInput | null,
): ReadonlyMap<string, { x: number; y: number }> {
  const laid = layoutPlan(plan, SOURCES, { rankdir, previous });
  return new Map(laid.nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
}

function at(
  positions: ReadonlyMap<string, { x: number; y: number }>,
  id: string,
): { x: number; y: number } {
  const position = positions.get(id);
  if (!position) throw new Error(`missing node ${id}`);
  return position;
}

function chain(): AgentPlanInput {
  return planOf(
    [boundary("start", "start"), agent("a"), boundary("end", "end")],
    [edge("start", "a"), edge("a", "end")],
  );
}

describe("layered layout of a plan", () => {
  it("lays a chain out downwards with centred ranks starting at the outer origin", () => {
    const positions = layout(chain());

    expect(at(positions, "start")).toEqual({ x: 120, y: 40 });
    expect(at(positions, "a")).toEqual({ x: 40, y: 40 + BOUNDARY_HEIGHT + 80 });
    expect(at(positions, "end")).toEqual({
      x: 120,
      y: 40 + BOUNDARY_HEIGHT + 80 + AGENT_HEIGHT + 80,
    });
  });

  it("lays a chain out from left to right for the LR direction", () => {
    const positions = layout(chain(), "LR");

    expect(at(positions, "start")).toEqual({ x: 40, y: 180 });
    expect(at(positions, "a")).toEqual({ x: 40 + BOUNDARY_WIDTH + 80, y: 40 });
    expect(at(positions, "end")).toEqual({
      x: 40 + BOUNDARY_WIDTH + 80 + AGENT_WIDTH + 80,
      y: 180,
    });
  });

  it("keeps everything but the positions of the plan", () => {
    const plan = chain();
    const laid = layoutPlan(plan, SOURCES, { rankdir: "TB" });

    expect(laid.name).toBe(plan.name);
    expect(laid.edges).toBe(plan.edges);
    expect(laid.nodes.map((node) => node.id)).toEqual(["start", "a", "end"]);
    expect(plan.nodes[1]).toMatchObject({ x: 0, y: 0 });
  });

  it("ignores stored positions without a previous plan", () => {
    const plan = planOf(
      [boundary("start", "start"), agent("a", {}, 900)],
      [edge("start", "a")],
    );

    expect(at(layout(plan), "a").x).toBe(40);
  });

  it("lays out an empty plan", () => {
    expect(layoutPlan(planOf([]), SOURCES, { rankdir: "TB" }).nodes).toEqual(
      [],
    );
  });

  it("ignores edges that name unknown nodes or leave a node to itself", () => {
    const plan = planOf(
      [boundary("start", "start"), agent("a")],
      [
        edge("start", "a"),
        edge("ghost", "a"),
        edge("a", "ghost"),
        edge("a", "a"),
      ],
    );

    const positions = layout(plan);

    expect(at(positions, "start").y).toBe(40);
    expect(at(positions, "a").y).toBe(40 + BOUNDARY_HEIGHT + 80);
  });

  it("breaks a cycle at the edge that leads back to the start of the loop", () => {
    const plan = planOf(
      [boundary("start", "start"), agent("a"), agent("b")],
      [edge("start", "a"), edge("a", "b"), edge("b", "a")],
    );

    const positions = layout(plan);

    expect(at(positions, "a").y).toBeLessThan(at(positions, "b").y);
    expect(at(positions, "start").y).toBeLessThan(at(positions, "a").y);
  });

  it("opens the search of a cycle without a root at the first box", () => {
    const plan = planOf(
      [agent("a"), agent("b")],
      [edge("a", "b"), edge("b", "a")],
    );

    const positions = layout(plan);

    expect(at(positions, "a").y).toBe(40);
    expect(at(positions, "b").y).toBe(40 + AGENT_HEIGHT + 80);
  });

  it("does not let an event edge order anything", () => {
    const plan = planOf(
      [agent("a"), agent("b")],
      [{ from: "a", to: "b", fromPort: "flow-out", toPort: "event-in" }],
    );

    const positions = layout(plan);

    expect(at(positions, "a").y).toBe(at(positions, "b").y);
    expect(at(positions, "a").x).not.toBe(at(positions, "b").x);
  });

  it("places a value source one rank before its first target", () => {
    const plan = planOf(
      [
        boundary("start", "start"),
        agent("a"),
        agent("b", { input: { kind: "source", nodeId: "p" } }),
        parameter("p"),
      ],
      [edge("start", "a"), edge("a", "b")],
    );

    const positions = layout(plan);

    expect(at(positions, "p").y).toBe(at(positions, "a").y);
    expect(at(positions, "b").y).toBeGreaterThan(at(positions, "a").y);
  });
});

describe("value sources and the order within a rank", () => {
  it("shifts all ranks when a value source moves before the first one", () => {
    const plan = planOf([
      agent("a", { input: { kind: "source", nodeId: "p" } }),
      parameter("p"),
    ]);

    const positions = layout(plan);

    expect(at(positions, "p").y).toBe(40);
    expect(at(positions, "a").y).toBe(40 + 166 + 80);
  });

  it("reads result and stack bindings as sources and ignores the others", () => {
    const plan = planOf([
      agent("a", { input: { kind: "result", stepId: "p" } }),
      agent("b", { input: { kind: "stack", stackId: "q", output: "count" } }),
      agent("c", { input: { kind: "previous", stepId: "p" } }),
      agent("d", {
        input: { kind: "literal", value: { type: "text", text: "text" } },
      }),
      parameter("p"),
      parameter("q"),
    ]);

    const positions = layout(plan);

    expect(at(positions, "p").y).toBeLessThan(at(positions, "a").y);
    expect(at(positions, "q").y).toBeLessThan(at(positions, "b").y);
    expect(at(positions, "c").y).toBe(at(positions, "d").y);
    expect(at(positions, "c").y).toBe(at(positions, "a").y);
  });

  it("lets a flow link win over a data link between the same nodes", () => {
    const plan = planOf(
      [parameter("p"), agent("a", { input: { kind: "source", nodeId: "p" } })],
      [edge("p", "a")],
    );

    const positions = layout(plan);

    expect(at(positions, "p").y).toBe(40);
    expect(at(positions, "a").y).toBe(40 + 166 + 80);
  });

  it("orders a rank by the barycenter of its predecessors", () => {
    const plan = planOf(
      [
        boundary("start", "start"),
        agent("x"),
        agent("y"),
        agent("p"),
        agent("q"),
      ],
      [edge("start", "x"), edge("start", "y"), edge("y", "p"), edge("x", "q")],
    );

    const positions = layout(plan);

    expect(at(positions, "x").x).toBeLessThan(at(positions, "y").x);
    expect(at(positions, "q").x).toBeLessThan(at(positions, "p").x);
  });

  it("moves a value source next to the node it feeds in the second pass", () => {
    const plan = planOf(
      [
        boundary("start", "start"),
        parameter("s1"),
        parameter("s2"),
        agent("a", { input: { kind: "source", nodeId: "s2" } }),
        agent("b", { input: { kind: "source", nodeId: "s1" } }),
      ],
      [edge("start", "a"), edge("start", "b")],
    );

    const positions = layout(plan);

    expect(at(positions, "s1").x).toBeLessThan(at(positions, "start").x);
    expect(at(positions, "start").x).toBeLessThan(at(positions, "s2").x);
    expect(at(positions, "b").x).toBeLessThan(at(positions, "a").x);
  });

  it("wraps a rank that is wider than the grid without covering or passing the limit", () => {
    const nodes = Array.from({ length: 30 }, (_, index) => agent(`n${index}`));

    for (const rankdir of ["TB", "LR"] as const) {
      const positions = layout(planOf(nodes), rankdir);
      const boxes = [...positions.values()];

      expect(boxes).toHaveLength(30);
      for (const box of boxes) {
        expect(box.x).toBeLessThanOrEqual(6000);
        expect(box.y).toBeLessThanOrEqual(6000);
      }
      for (const [index, first] of boxes.entries())
        for (const second of boxes.slice(index + 1))
          expect(
            first.x < second.x + AGENT_WIDTH &&
              second.x < first.x + AGENT_WIDTH &&
              first.y < second.y + AGENT_HEIGHT &&
              second.y < first.y + AGENT_HEIGHT,
          ).toBe(false);
    }
  });
});

describe("frames in the layout", () => {
  it("lays the members of a group out inside it, chained by their order", () => {
    const plan = planOf([groupOf("g", [agent("s1"), agent("s2")])]);

    const laid = layoutPlan(plan, SOURCES, { rankdir: "TB" });
    const group = laid.nodes[0];

    expect(group).toMatchObject({ id: "g", x: 40, y: 40 });
    if (group?.type !== "group") throw new Error("expected a group");
    expect(group.steps.map((step) => ({ x: step.x, y: step.y }))).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: AGENT_HEIGHT + 80 },
    ]);
  });

  it("uses the explicit edges of a group", () => {
    const group = {
      ...groupOf("g", [agent("s1"), agent("s2")]),
      edges: [edge("s2", "s1")],
    };

    const laid = layoutPlan(planOf([group]), SOURCES, { rankdir: "TB" });
    const placed = laid.nodes[0];

    if (placed?.type !== "group") throw new Error("expected a group");
    const [first, second] = placed.steps;
    expect(second?.y).toBe(0);
    expect(first?.y).toBe(AGENT_HEIGHT + 80);
  });

  it("orders a frame by the edges and bindings that reach its members", () => {
    const plan = planOf(
      [
        boundary("start", "start"),
        groupOf("g", [agent("s1")]),
        agent("after"),
        parameter("p"),
        agent("user", { input: { kind: "source", nodeId: "s1" } }),
      ],
      [edge("start", "s1"), edge("s1", "after"), edge("s1", "user")],
    );

    const positions = layout(plan);

    expect(at(positions, "start").y).toBeLessThan(at(positions, "g").y);
    expect(at(positions, "g").y).toBeLessThan(at(positions, "after").y);
    expect(at(positions, "after").y).toBe(at(positions, "user").y);
  });

  it("lays out a loop with its members and the groups inside it", () => {
    const inner = groupOf("g", [agent("s1"), agent("s2")]);
    const loop: AgentPlanLoop = loopOf(
      "l",
      [agent("m1"), inner],
      [edge("m1", "g")],
    );

    const laid = layoutPlan(planOf([loop]), SOURCES, { rankdir: "TB" });
    const placed = laid.nodes[0];

    if (placed?.type !== "loop") throw new Error("expected a loop");
    const [member, group] = placed.steps;
    // The narrower member is centred over the wider group below it.
    expect(member).toMatchObject({ id: "m1", x: 180, y: 0 });
    expect(group).toMatchObject({ id: "g", x: 0 });
    expect(group?.y).toBe(AGENT_HEIGHT + 80);
    if (group?.type !== "group") throw new Error("expected a group");
    expect(group.steps[1]?.y).toBe(AGENT_HEIGHT + 80);
  });

  it("sizes a frame the way its members are laid out", () => {
    const plan = planOf([groupOf("g", [agent("s1"), agent("s2")]), agent("a")]);

    const laid = layoutPlan(plan, SOURCES, { rankdir: "TB" });
    const group = laid.nodes[0];

    if (!group) throw new Error("missing group");
    expect(planNodeHeight(group, SOURCES)).toBeGreaterThan(
      2 * AGENT_HEIGHT + 80,
    );
    expect(planNodeWidth(group)).toBeGreaterThanOrEqual(680);
  });
});

describe("replacing a stored plan", () => {
  function stored(): AgentPlanInput {
    return planOf([
      { ...boundary("start", "start"), x: 10, y: 10 },
      { ...agent("a"), x: 500, y: 500 },
    ]);
  }

  function replacement(): AgentPlanInput {
    return planOf(
      [boundary("start", "start"), agent("a"), agent("b")],
      [edge("start", "a"), edge("a", "b")],
    );
  }

  it("keeps stored positions exactly when nothing is new", () => {
    const positions = layout(
      planOf([boundary("start", "start"), agent("a")]),
      "TB",
      stored(),
    );

    expect(at(positions, "start")).toEqual({ x: 10, y: 10 });
    expect(at(positions, "a")).toEqual({ x: 500, y: 500 });
  });

  it("places a new node below what stays for TB", () => {
    const positions = layout(replacement(), "TB", stored());

    expect(at(positions, "start")).toEqual({ x: 10, y: 10 });
    expect(at(positions, "a")).toEqual({ x: 500, y: 500 });
    expect(at(positions, "b")).toEqual({ x: 10, y: 500 + AGENT_HEIGHT + 80 });
  });

  it("places a new node beside what stays for LR", () => {
    const positions = layout(replacement(), "LR", stored());

    expect(at(positions, "b")).toEqual({ x: 500 + AGENT_WIDTH + 80, y: 10 });
  });

  it("falls back to the other side when the first is too small", () => {
    const previous = planOf([
      { ...boundary("start", "start"), x: 10, y: 5900 },
      { ...agent("a"), x: 500, y: 100 },
    ]);
    const plan = planOf(
      [boundary("start", "start"), agent("a"), boundary("end", "end")],
      [edge("start", "a"), edge("a", "end")],
    );

    const positions = layout(plan, "TB", previous);

    expect(at(positions, "end")).toEqual({ x: 500 + AGENT_WIDTH + 80, y: 100 });
  });

  it("refuses when new nodes fit nowhere beside what stays", () => {
    const previous = planOf([{ ...agent("a"), x: 5900, y: 5900 }]);
    const plan = planOf([agent("a"), agent("b")], [edge("a", "b")]);

    expect(() => layout(plan, "TB", previous)).toThrow(PlanLayoutOverflowError);
  });

  it("treats an empty previous plan like none", () => {
    const positions = layout(chain(), "TB", null);

    expect(at(positions, "start")).toEqual({ x: 120, y: 40 });
  });

  it("moves a grown frame instead of letting it cover its neighbour", () => {
    const previous = planOf([
      { ...groupOf("g", [agent("s")]), x: 40, y: 40 },
      { ...agent("a"), x: 40, y: 560 },
    ]);
    const plan = planOf([groupOf("g", [agent("s"), agent("s2")]), agent("a")]);

    const positions = layout(plan, "TB", previous);

    expect(at(positions, "a")).toEqual({ x: 40, y: 560 });
    expect(at(positions, "g")).toEqual({ x: 40, y: 560 + AGENT_HEIGHT + 80 });
  });

  it("keeps a grown frame in place when nothing stands in its way", () => {
    const previous = planOf([{ ...groupOf("g", [agent("s")]), x: 40, y: 40 }]);
    const plan = planOf([groupOf("g", [agent("s"), agent("s2")])]);

    const positions = layout(plan, "TB", previous);

    expect(at(positions, "g")).toEqual({ x: 40, y: 40 });
  });
});

describe("overflowing layouts", () => {
  const many = (count: number): AgentPlanStep[] =>
    Array.from({ length: count }, (_, index) => agent(`n${index}`));

  it("refuses an outer graph that fits no band", () => {
    let error: unknown;
    try {
      layout(planOf(many(400)));
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(PlanLayoutOverflowError);
    expect(error).toMatchObject({
      name: "PlanLayoutOverflowError",
      containerId: null,
      message: "The plan layout does not fit the coordinate limit.",
    });
  });

  it("names the group whose members do not fit", () => {
    expect(() => layout(planOf([groupOf("g", many(400))]))).toThrow(
      expect.objectContaining({ containerId: "g" }),
    );
  });

  it("names the loop whose members do not fit", () => {
    expect(() => layout(planOf([loopOf("l", many(400))]))).toThrow(
      expect.objectContaining({ containerId: "l" }),
    );
  });
});
