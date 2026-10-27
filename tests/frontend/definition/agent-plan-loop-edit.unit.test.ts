import { describe, expect, it } from "vitest";

import {
  connectLoopFlow,
  disconnectLoopFlow,
  findPlanLoopMember,
  findPlanNodeLocation,
  placePlanLoopNode,
  replaceLoopMember,
  ungroupPlanLoop,
} from "@/definition/AgentPlanLoopEdit";

import { agent, edge, groupOf, loopOf, planOf, script } from "./plan-fixtures";

import type {
  AgentPlanBinding,
  AgentPlanInput,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";

const NOWHERE = { x: 10, y: 20 };
const result = (stepId: string): AgentPlanBinding => ({
  kind: "result",
  stepId,
});
const previous = (stepId: string): AgentPlanBinding => ({
  kind: "previous",
  stepId,
});
const literal: AgentPlanBinding = { kind: "literal", value: null };
const detached = (): never => {
  throw new Error("The group edit must not run.");
};

/** Group edit double: frees the agent by moving it onto the outer grid. */
const context = {
  agents: [],
  detachFromGroup: (
    plan: AgentPlanInput,
    step: AgentPlanStep,
  ): AgentPlanInput => ({
    ...plan,
    nodes: [
      ...plan.nodes.map((node) =>
        node.type === "group"
          ? {
              ...node,
              steps: node.steps.filter((entry) => entry.id !== step.id),
            }
          : node,
      ),
      step,
    ],
  }),
};

describe("finding nodes", () => {
  const first = agent("first");
  const plan = planOf([
    agent("outer"),
    script("outer-script"),
    groupOf("group", [agent("grouped")]),
    loopOf("loop", [first, script("member-script")]),
  ]);

  it("locates a node outside every frame, in a group and in a loop", () => {
    expect(findPlanNodeLocation(plan, "outer")).toMatchObject({
      group: null,
      loop: null,
    });
    expect(findPlanNodeLocation(plan, "outer-script")?.node.type).toBe(
      "script",
    );
    expect(findPlanNodeLocation(plan, "grouped")?.group?.id).toBe("group");
    expect(findPlanNodeLocation(plan, "first")?.loop?.id).toBe("loop");
    expect(findPlanNodeLocation(plan, "unknown")).toBeNull();
  });

  it("does not take a group or a loop for a member", () => {
    expect(findPlanNodeLocation(plan, "group")).toBeNull();
    expect(findPlanNodeLocation(plan, "loop")).toBeNull();
  });

  it("finds a loop member together with its loop", () => {
    expect(findPlanLoopMember(plan, "first")).toEqual({
      member: first,
      loop: plan.nodes[3],
    });
    expect(findPlanLoopMember(plan, "outer")).toBeNull();
  });
});

describe("placing a node", () => {
  it("moves a member inside its own loop without any loss", () => {
    const plan = planOf([loopOf("loop", [agent("a"), agent("b")])]);

    const moved = placePlanLoopNode(
      plan,
      { nodeId: "a", loopId: "loop", position: NOWHERE },
      context,
    );

    expect(moved).toMatchObject({ removedEdges: 0, removedBindings: 0 });
    expect(typeof moved).toBe("object");
    if (typeof moved === "string") return;
    const [loop] = moved.plan.nodes;
    expect(loop?.type === "loop" && loop.steps[0]).toMatchObject(NOWHERE);
  });

  it("refuses a node that does not exist and a loop that does not exist", () => {
    const plan = planOf([agent("a"), loopOf("loop", [])]);

    expect(
      placePlanLoopNode(
        plan,
        { nodeId: "ghost", loopId: null, position: NOWHERE },
        context,
      ),
    ).toBe("missingAgent");
    expect(
      placePlanLoopNode(
        plan,
        { nodeId: "a", loopId: "ghost", position: NOWHERE },
        context,
      ),
    ).toBe("missingAgent");
  });

  it("takes an outer node into a loop and ends its outer connections and result bindings", () => {
    const plan = planOf(
      [
        agent("mover", { input: result("other"), fixed: literal }),
        agent("other"),
        agent("follower", { upstream: result("mover") }),
        {
          id: "note",
          type: "parameter",
          name: "p",
          format: "string",
          x: 0,
          y: 0,
          value: { type: "text", text: "" },
        },
        loopOf("loop", []),
      ],
      [
        edge("other", "mover"),
        edge("mover", "follower"),
        edge("other", "follower"),
      ],
    );

    const moved = placePlanLoopNode(
      plan,
      { nodeId: "mover", loopId: "loop", position: NOWHERE },
      context,
    );

    if (typeof moved === "string") throw new Error(moved);
    expect(moved.removedEdges).toBe(2);
    // The node's own result binding and the follower's binding to the node.
    expect(moved.removedBindings).toBe(2);
    expect(moved.plan.edges).toEqual([edge("other", "follower")]);
    const loop = moved.plan.nodes.find((node) => node.type === "loop");
    expect(loop?.type === "loop" && loop.steps).toEqual([
      expect.objectContaining({
        id: "mover",
        ...NOWHERE,
        bindings: { fixed: literal },
      }),
    ]);
    expect(moved.plan.nodes.map((node) => node.id)).not.toContain(
      "mover" + "x",
    );
  });
});

describe("leaving a loop", () => {
  it("takes a loop member out onto the outer grid and ends its internal connections", () => {
    const plan = planOf([
      loopOf(
        "loop",
        [
          agent("a", { out: previous("b") }),
          agent("b", { in: result("a") }),
          script("c", { in: result("b"), fixed: literal }),
        ],
        [edge("a", "b"), edge("b", "c")],
        {
          condition: {
            isEnabled: true,
            sourceNodeId: "b",
            outputPath: "$.done",
            operator: "equals",
            expected: { type: "boolean", value: true },
          },
        },
      ),
    ]);

    const moved = placePlanLoopNode(
      plan,
      { nodeId: "b", loopId: null, position: NOWHERE },
      context,
    );

    if (typeof moved === "string") throw new Error(moved);
    expect(moved.removedEdges).toBe(2);
    // b's own binding is empty of results; a and c lose the bindings that name b.
    expect(moved.removedBindings).toBe(3);
    const loop = moved.plan.nodes.find((node) => node.type === "loop");
    expect(loop?.type === "loop" && loop.steps.map((step) => step.id)).toEqual([
      "a",
      "c",
    ]);
    expect(loop?.type === "loop" && loop.edges).toEqual([]);
    expect(loop?.type === "loop" && loop.condition?.sourceNodeId).toBe("");
    expect(moved.plan.nodes.at(-1)).toMatchObject({ id: "b", ...NOWHERE });
  });

  it("keeps a condition that reads another member when a member leaves", () => {
    const condition = {
      isEnabled: true,
      sourceNodeId: "a",
      outputPath: "$.done",
      operator: "equals" as const,
      expected: { type: "null" as const },
    };
    const plan = planOf([
      loopOf("loop", [agent("a"), agent("b")], [], { condition }),
    ]);

    const moved = placePlanLoopNode(
      plan,
      { nodeId: "b", loopId: null, position: NOWHERE },
      context,
    );

    if (typeof moved === "string") throw new Error(moved);
    const loop = moved.plan.nodes.find((node) => node.type === "loop");
    expect(loop?.type === "loop" && loop.condition).toEqual(condition);
  });
});

describe("moving between frames", () => {
  it("moves a member from one loop to another without touching the outer graph", () => {
    const plan = planOf(
      [
        loopOf(
          "from",
          [agent("a", { x: result("b") }), agent("b")],
          [edge("a", "b")],
        ),
        loopOf("to", [agent("c")]),
        agent("outer"),
      ],
      [edge("outer", "from")],
    );

    const moved = placePlanLoopNode(
      plan,
      { nodeId: "a", loopId: "to", position: NOWHERE },
      context,
    );

    if (typeof moved === "string") throw new Error(moved);
    expect(moved.removedEdges).toBe(1);
    // The result binding of a to b would cross the border of the loop.
    expect(moved.removedBindings).toBe(1);
    expect(moved.plan.edges).toEqual([edge("outer", "from")]);
    const target = moved.plan.nodes.find((node) => node.id === "to");
    expect(
      target?.type === "loop" && target.steps.map((step) => step.id),
    ).toEqual(["c", "a"]);
  });

  it("frees an agent from its group first and keeps what the group edit refuses", () => {
    const plan = planOf([
      groupOf("group", [agent("grouped")]),
      loopOf("loop", []),
    ]);

    const moved = placePlanLoopNode(
      plan,
      { nodeId: "grouped", loopId: "loop", position: NOWHERE },
      context,
    );
    const refused = placePlanLoopNode(
      plan,
      { nodeId: "grouped", loopId: "loop", position: NOWHERE },
      { agents: [], detachFromGroup: () => "otherAdapter" },
    );

    if (typeof moved === "string") throw new Error(moved);
    const group = moved.plan.nodes.find((node) => node.type === "group");
    const loop = moved.plan.nodes.find((node) => node.type === "loop");
    expect(group?.type === "group" && group.steps).toEqual([]);
    expect(loop?.type === "loop" && loop.steps.map((step) => step.id)).toEqual([
      "grouped",
    ]);
    expect(refused).toBe("otherAdapter");
  });

  it("takes a script out of a group-less grid onto the grid again at the new position", () => {
    const plan = planOf([script("s")]);

    const moved = placePlanLoopNode(
      plan,
      { nodeId: "s", loopId: null, position: NOWHERE },
      { agents: [], detachFromGroup: detached },
    );

    if (typeof moved === "string") throw new Error(moved);
    expect(moved.plan.nodes.filter((node) => node.id === "s")).toHaveLength(2);
    expect(moved.removedEdges).toBe(0);
  });
});

describe("ungrouping a loop", () => {
  const plan = planOf(
    [
      agent("before"),
      loopOf(
        "loop",
        [
          agent("a", { carry: previous("b"), keep: result("b") }),
          agent("b"),
          agent("c"),
        ],
        [edge("a", "b")],
      ),
      agent("after"),
    ],
    [edge("before", "loop"), edge("loop", "after"), edge("before", "after")],
  );

  it("keeps the members at their grid positions with the entries and exits of the loop", () => {
    const {
      plan: next,
      removedBindings,
      removedEdges,
    } = ungroupPlanLoop(plan, "loop", (member) => ({
      x: member.id.charCodeAt(0),
      y: 7,
    }));

    expect(removedBindings).toBe(1);
    expect(removedEdges).toBe(0);
    expect(next.nodes.map((node) => node.id)).toEqual([
      "before",
      "after",
      "a",
      "b",
      "c",
    ]);
    expect(next.nodes.find((node) => node.id === "a")).toMatchObject({
      x: 97,
      y: 7,
      bindings: { keep: result("b") },
    });
    // Entries are a and c (no predecessor); exits are b and c (no successor).
    expect(next.edges).toEqual([
      edge("before", "a"),
      edge("before", "c"),
      edge("b", "after"),
      edge("c", "after"),
      edge("before", "after"),
      edge("a", "b"),
    ]);
  });

  it("leaves the plan alone when the loop does not exist", () => {
    expect(ungroupPlanLoop(plan, "ghost", () => NOWHERE)).toEqual({
      plan,
      removedEdges: 0,
      removedBindings: 0,
    });
  });
});

describe("editing loop internals", () => {
  const plan = planOf([
    loopOf("loop", [agent("a"), agent("b")], [edge("a", "b")]),
    loopOf("other", [agent("c")]),
    agent("outer"),
  ]);

  it("replaces a member in its own loop only", () => {
    const replacement = agent("a", { fixed: literal }, 42);

    const next = replaceLoopMember(plan, replacement);

    const loop = next.nodes[0];
    expect(loop?.type === "loop" && loop.steps).toEqual([
      replacement,
      plan.nodes[0] && (plan.nodes[0] as AgentPlanLoop).steps[1],
    ]);
    expect(next.nodes.slice(1)).toEqual(plan.nodes.slice(1));
  });

  it("connects and disconnects flow inside one loop", () => {
    const loop = plan.nodes[1] as AgentPlanLoop;
    const connected = connectLoopFlow(plan, loop, edge("c", "c2"));
    const target = connected.nodes[1];

    expect(target?.type === "loop" && target.edges).toEqual([edge("c", "c2")]);
    expect(connected.nodes[0]).toBe(plan.nodes[0]);

    const cut = disconnectLoopFlow(plan, "loop", { from: "a", to: "b" });
    const untouched = disconnectLoopFlow(plan, "loop", { from: "a", to: "x" });
    const first = cut.nodes[0];

    expect(first?.type === "loop" && first.edges).toEqual([]);
    expect(cut.nodes[1]).toBe(plan.nodes[1]);
    expect(untouched.nodes[0]).toMatchObject({ edges: [edge("a", "b")] });
  });
});
