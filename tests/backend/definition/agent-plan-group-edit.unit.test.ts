import { describe, expect, it } from "vitest";

import {
  findPlanBindingTarget,
  findPlanStep,
  placePlanStep,
  replacePlanNode,
} from "@/definition/AgentPlanGroupEdit";

import {
  AGENTS,
  closeout,
  decision,
  groupIn,
  member,
  moveOf,
  nodeOf,
  pairs,
  stepIds,
  TEXT_HELLO,
} from "./group-edit-fixtures";
import { edge, groupOf, loopOf, planOf, script } from "./plan-fixtures";

import type { AgentPlanInput, AgentPlanNode } from "@/definition/AgentPlan";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";

describe("finding an agent node", () => {
  const plan = planOf([
    member("top"),
    groupOf("g", [member("in-group")]),
    loopOf("l", [member("in-loop"), groupOf("lg", [member("in-loop-group")])]),
    script("s"),
  ]);

  it("tells where an agent stands: outside, in a group, in a loop or in a group of a loop", () => {
    expect(findPlanStep(plan, "top")).toMatchObject({
      group: null,
      loop: null,
    });
    expect(findPlanStep(plan, "in-group")).toMatchObject({
      group: { id: "g" },
      loop: null,
    });
    expect(findPlanStep(plan, "in-loop")).toMatchObject({
      group: null,
      loop: { id: "l" },
    });
    expect(findPlanStep(plan, "in-loop-group")).toMatchObject({
      group: { id: "lg" },
      loop: { id: "l" },
    });
  });

  it("finds no script, no frame and no unknown id", () => {
    expect(findPlanStep(plan, "s")).toBeNull();
    expect(findPlanStep(plan, "g")).toBeNull();
    expect(findPlanStep(plan, "nowhere")).toBeNull();
  });
});

describe("finding the node a binding fills", () => {
  const plan = planOf([
    member("top"),
    groupOf("g", [member("in-group")]),
    loopOf("l", [member("in-loop"), script("loop-script")]),
    script("s"),
    closeout("c"),
    { id: "p", type: "end", x: 0, y: 0 },
  ]);

  it("finds agents anywhere and the scripts of a loop", () => {
    expect(findPlanBindingTarget(plan, "top")?.id).toBe("top");
    expect(findPlanBindingTarget(plan, "in-group")?.id).toBe("in-group");
    expect(findPlanBindingTarget(plan, "in-loop")?.id).toBe("in-loop");
    expect(findPlanBindingTarget(plan, "loop-script")?.type).toBe("script");
  });

  it("finds an outer script, a closeout, a frame and a loop by their own id", () => {
    expect(findPlanBindingTarget(plan, "s")?.type).toBe("script");
    expect(findPlanBindingTarget(plan, "c")?.type).toBe("git_closeout");
    expect(findPlanBindingTarget(plan, "g")?.type).toBe("group");
    expect(findPlanBindingTarget(plan, "l")?.type).toBe("loop");
  });

  it("finds nothing for nodes without inputs or unknown ids", () => {
    expect(findPlanBindingTarget(plan, "p")).toBeNull();
    expect(findPlanBindingTarget(plan, "nowhere")).toBeNull();
  });
});

describe("replacing a node", () => {
  it("replaces an outer node by its id", () => {
    const plan = planOf([member("a"), script("s")]);
    const replacement = { ...script("s"), content: "echo changed" };

    const result = replacePlanNode(plan, replacement);

    expect(nodeOf(result, "s")).toBe(replacement);
    expect(nodeOf(result, "a")).toBe(nodeOf(plan, "a"));
  });

  it("replaces an agent inside a group and leaves other groups alone", () => {
    const other = groupOf("other", [member("x")]);
    const plan = planOf([groupOf("g", [member("a"), member("b")]), other]);
    const changed = { ...member("b"), instruction: "new" };

    const result = replacePlanNode(plan, changed);

    expect(groupIn(result, "g").steps[1]).toBe(changed);
    expect(groupIn(result, "g").steps[0]).toBe(groupIn(plan, "g").steps[0]);
    expect(nodeOf(result, "other")).toBe(other);
  });

  it("replaces members of a loop, those of its groups and a decision", () => {
    const plan = planOf([
      loopOf(
        "l",
        [member("a"), script("s"), groupOf("lg", [member("in-group")])],
        [],
        { decisions: [decision("d")] },
      ),
    ]);
    const agentChange = { ...member("in-group"), instruction: "x" };
    const scriptChange = { ...script("s"), content: "echo" };
    const decisionChange = { ...decision("d"), name: "Named" };

    const afterAgent = replacePlanNode(plan, agentChange);
    const afterScript = replacePlanNode(plan, scriptChange);
    const afterDecision = replacePlanNode(plan, decisionChange);

    const loopOfPlan = (result: AgentPlanInput): AgentPlanNode =>
      nodeOf(result, "l");
    expect(loopOfPlan(afterAgent)).toMatchObject({
      steps: [
        { id: "a" },
        { id: "s" },
        { id: "lg", steps: [{ instruction: "x" }] },
      ],
    });
    expect(loopOfPlan(afterScript)).toMatchObject({
      steps: [{ id: "a" }, { content: "echo" }, { id: "lg" }],
    });
    expect(loopOfPlan(afterDecision)).toMatchObject({
      decisions: [{ id: "d", name: "Named" }],
    });
  });
});

describe("moving an agent node between frames", () => {
  const position = { x: 40, y: 50 };

  it("refuses an unknown node and an unknown group", () => {
    const plan = planOf([member("a"), groupOf("g", [])]);

    expect(
      placePlanStep(plan, { stepId: "x", groupId: null, position }, AGENTS),
    ).toBe("missingAgent");
    expect(
      placePlanStep(plan, { stepId: "a", groupId: "none", position }, AGENTS),
    ).toBe("missingAgent");
  });

  it("only repositions a node that stays outside or in its own group", () => {
    const plan = planOf([member("a"), groupOf("g", [member("b")])]);

    const outside = moveOf(
      placePlanStep(plan, { stepId: "a", groupId: null, position }, AGENTS),
    );
    const inside = moveOf(
      placePlanStep(plan, { stepId: "b", groupId: "g", position }, AGENTS),
    );

    expect(nodeOf(outside.plan, "a")).toMatchObject(position);
    expect(groupIn(inside.plan, "g").steps[0]).toMatchObject({
      id: "b",
      ...position,
    });
    expect([outside, inside].map((move) => move.removedEdges)).toEqual([0, 0]);
  });

  it("refuses a node the group cannot take and leaves the plan alone", () => {
    const plan = planOf([
      member("api", "api"),
      member("claude", "claude"),
      member("blank", "blank"),
      groupOf("g", [member("first", "codex")]),
    ]);
    const place = (stepId: string): ReturnType<typeof placePlanStep> =>
      placePlanStep(plan, { stepId, groupId: "g", position }, AGENTS);

    expect(place("api")).toBe("notAcp");
    expect(place("claude")).toBe("otherAdapter");
    expect(place("blank")).toBe("missingAgent");
  });

  it("takes an outer node into a group and keeps the flow between members inside it", () => {
    const plan = planOf(
      [groupOf("g", [member("a")]), member("b"), member("c")],
      [edge("a", "b"), edge("b", "c")],
    );

    const move = moveOf(
      placePlanStep(plan, { stepId: "b", groupId: "g", position }, AGENTS),
    );

    const group = groupIn(move.plan, "g");
    expect(stepIds(group)).toEqual(["a", "b"]);
    expect(group.steps[1]).toMatchObject(position);
    expect(pairs(group.edges)).toEqual(["a>b"]);
    expect(pairs(move.plan.edges)).toEqual(["b>c"]);
    expect(move.plan.nodes.map((node) => node.id)).toEqual(["g", "c"]);
  });

  it("takes a node out of its group, keeping edges outside and resolving alias bindings", () => {
    const inner = member("b", "codex", {
      topic: { kind: "source", nodeId: "port" },
    });
    const group: AgentPlanGroup = {
      ...groupOf("g", [member("a"), inner]),
      edges: [edge("a", "b")],
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
    const plan = planOf([group, member("c")], [edge("b", "c")]);

    const move = moveOf(
      placePlanStep(plan, { stepId: "b", groupId: null, position }, AGENTS),
    );

    expect(stepIds(groupIn(move.plan, "g"))).toEqual(["a"]);
    expect(pairs(groupIn(move.plan, "g").edges)).toEqual([]);
    expect(pairs(move.plan.edges)).toEqual(["b>c", "a>b"]);
    expect(nodeOf(move.plan, "b")).toMatchObject({
      ...position,
      bindings: { topic: TEXT_HELLO },
    });
  });

  it("moves a node from one group to another", () => {
    const plan = planOf([
      groupOf("g", [member("a"), member("b")]),
      groupOf("h", [member("c")]),
    ]);

    const move = moveOf(
      placePlanStep(plan, { stepId: "b", groupId: "h", position }, AGENTS),
    );

    expect(stepIds(groupIn(move.plan, "g"))).toEqual(["a"]);
    expect(stepIds(groupIn(move.plan, "h"))).toEqual(["c", "b"]);
    // The joined node arrives unconnected; it is never chained to the others.
    expect(pairs(groupIn(move.plan, "h").edges)).toEqual([]);
  });
});
