import { describe, expect, it } from "vitest";

import {
  PLAN_FRAME_PADDING,
  planGroupHeaderHeight,
  planMemberOrigin,
} from "@/app/components/agents/plans/plan-layout";

import {
  agentNode,
  flowEdge,
  planOf,
  sessionGroup,
} from "./plan-group-fixture";
import {
  dropAt,
  loopWith,
  mountGroupActions,
  mountRecordedActions,
  stepOf,
} from "./use-plan-group-actions-fixture";

import type { AgentPlanDecision, AgentPlanInput } from "@/definition/AgentPlan";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";
import type { AgentPlanStack } from "@/definition/AgentPlanStack";

function nodeIds(plan: AgentPlanInput): string[] {
  return plan.nodes.map((node) => node.id);
}

function loopOf(plan: AgentPlanInput): AgentPlanLoop {
  const loop = plan.nodes.find(
    (node): node is AgentPlanLoop => node.type === "loop",
  );
  if (!loop) throw new Error("No loop in the plan");
  return loop;
}

function groupOf(plan: AgentPlanInput): AgentPlanGroup {
  const group = plan.nodes.find(
    (node): node is AgentPlanGroup => node.type === "group",
  );
  if (!group) throw new Error("No group in the plan");
  return group;
}

describe("removing a frame", () => {
  it("remembers which frame waits for the choice until it is cancelled", () => {
    const scene = mountGroupActions(planOf([sessionGroup()]));

    scene.run((actions) => actions.requestRemoval("group"));
    expect(scene.actions().removalId).toBe("group");

    scene.run((actions) => actions.cancelRemoval());
    expect(scene.actions().removalId).toBeNull();
    expect(scene.removed).toEqual([]);
  });

  it("deletes a group with its members", () => {
    const scene = mountGroupActions(
      planOf([
        sessionGroup({ steps: [agentNode("a", "codex")] }),
        agentNode("other", "codex", { x: 900 }),
      ]),
    );
    scene.run((actions) => actions.requestRemoval("group"));

    scene.run((actions) => actions.removeGroup("group", false));

    expect(nodeIds(scene.draft())).toEqual(["other"]);
    expect(scene.removed).toEqual(["group"]);
    expect(scene.actions().removalId).toBeNull();
    expect(scene.actions().notice).toBeNull();
  });

  it("keeps the members of a group where the frame showed them", () => {
    const scene = mountGroupActions(
      planOf([
        sessionGroup({
          x: 100,
          y: 200,
          steps: [agentNode("a", "codex", { x: 30, y: 40 })],
        }),
      ]),
    );

    scene.run((actions) => actions.removeGroup("group", true));

    expect(nodeIds(scene.draft())).toEqual(["a"]);
    expect(stepOf(scene.draft(), "a")).toMatchObject({
      x: 100 + PLAN_FRAME_PADDING + 30,
      y: 200 + planGroupHeaderHeight() + 40,
    });
    expect(scene.removed).toEqual(["group"]);
    expect(scene.actions().notice).toBeNull();
  });

  it("refuses to dissolve a group whose outer connection would need repair", () => {
    const initial = planOf(
      [
        sessionGroup({ steps: [agentNode("a", "codex")] }),
        agentNode("other", "codex", { x: 900 }),
      ],
      [flowEdge("group", "other")],
    );
    const scene = mountGroupActions(initial);
    scene.run((actions) => actions.requestRemoval("group"));

    scene.run((actions) => actions.removeGroup("group", true));

    expect(scene.actions().notice).toEqual({ kind: "repair", name: "Session" });
    expect(scene.actions().removalId).toBeNull();
    expect(scene.draft()).toBe(initial);
    expect(scene.removed).toEqual([]);
  });

  it("still deletes a group together with its members despite an outer connection", () => {
    const scene = mountGroupActions(
      planOf(
        [
          sessionGroup({ steps: [agentNode("a", "codex")] }),
          agentNode("other", "codex", { x: 900 }),
        ],
        [flowEdge("group", "other")],
      ),
    );

    scene.run((actions) => actions.removeGroup("group", false));

    expect(nodeIds(scene.draft())).toEqual(["other"]);
    expect(scene.draft().edges).toEqual([]);
    expect(scene.removed).toEqual(["group"]);
  });

  it("does nothing for a frame that is already gone", () => {
    const initial = planOf([agentNode("a", "codex")]);
    const scene = mountGroupActions(initial);

    scene.run((actions) => {
      actions.removeGroup("ghost", true);
      actions.removeGroup("ghost", false);
    });

    expect(scene.draft()).toBe(initial);
    expect(scene.removed).toEqual([]);
  });

  it("deletes a loop with its members", () => {
    const scene = mountGroupActions(
      planOf([loopWith([agentNode("a", "codex")])]),
    );

    scene.run((actions) => actions.removeGroup("loop", false));

    expect(nodeIds(scene.draft())).toEqual([]);
    expect(scene.removed).toEqual(["loop"]);
  });

  it("keeps the members of a loop with their internal flow", () => {
    const scene = mountGroupActions(
      planOf([
        loopWith(
          [
            agentNode("a", "codex", { x: 10, y: 20 }),
            agentNode("b", "codex", { x: 400, y: 20 }),
          ],
          { edges: [flowEdge("a", "b")] },
        ),
      ]),
    );
    const origin = planMemberOrigin(loopWith([]));

    scene.run((actions) => actions.removeGroup("loop", true));

    expect(nodeIds(scene.draft())).toEqual(["a", "b"]);
    expect(stepOf(scene.draft(), "a")).toMatchObject({
      x: origin.x + 10,
      y: origin.y + 20,
    });
    expect(scene.draft().edges).toEqual([flowEdge("a", "b")]);
    expect(scene.actions().notice).toBeNull();
    expect(scene.removed).toEqual(["loop"]);
  });

  it("refuses to dissolve a loop whose member reads the previous iteration", () => {
    const initial = planOf([
      loopWith([
        agentNode("a", "codex", {
          bindings: { input1: { kind: "previous", stepId: "a" } },
        }),
      ]),
    ]);
    const scene = mountGroupActions(initial);

    scene.run((actions) => actions.removeGroup("loop", true));

    expect(scene.actions().notice).toEqual({
      kind: "repair",
      name: "Review loop",
    });
    expect(scene.draft()).toBe(initial);
    expect(scene.removed).toEqual([]);
  });

  it("dissolves a group inside a loop into members of the loop", () => {
    const nested = sessionGroup({
      id: "inner",
      x: 50,
      y: 60,
      steps: [agentNode("a", "codex", { x: 30, y: 40 })],
    });
    const scene = mountGroupActions(planOf([loopWith([nested])]));

    scene.run((actions) => actions.removeGroup("inner", true));

    expect(loopOf(scene.draft()).steps.map((member) => member.id)).toEqual([
      "a",
    ]);
    expect(stepOf(scene.draft(), "a")).toMatchObject({
      x: 50 + PLAN_FRAME_PADDING + 30,
      y: 60 + planGroupHeaderHeight(nested) + 40,
    });
    expect(scene.removed).toEqual(["inner"]);
  });

  it("deletes a group inside a loop with its members", () => {
    const nested = sessionGroup({
      id: "inner",
      steps: [agentNode("a", "codex")],
    });
    const scene = mountGroupActions(
      planOf([loopWith([nested, agentNode("keep", "codex", { x: 700 })])]),
    );

    scene.run((actions) => actions.removeGroup("inner", false));

    expect(loopOf(scene.draft()).steps.map((member) => member.id)).toEqual([
      "keep",
    ]);
    expect(scene.removed).toEqual(["inner"]);
  });

  it("does not dissolve a group that gained a connection while the choice was queued", () => {
    const initial = planOf([
      sessionGroup({ steps: [agentNode("a", "codex")] }),
    ]);
    const scene = mountRecordedActions(initial);

    scene.hook.result.current.actions.removeGroup("group", true);
    const connected = planOf(
      [
        initial.nodes[0] ?? sessionGroup(),
        agentNode("other", "codex", { x: 900 }),
      ],
      [flowEdge("group", "other")],
    );

    expect(scene.settle(connected)).toBe(connected);
    expect(scene.removed).toEqual(["group"]);
  });

  it("leaves a plan alone whose frame was deleted while the choice was queued", () => {
    const scene = mountRecordedActions(planOf([sessionGroup()]));

    scene.hook.result.current.actions.removeGroup("group", false);
    const gone = planOf([agentNode("a", "codex")]);

    expect(scene.settle(gone)).toBe(gone);
  });
});

describe("moving a whole group", () => {
  const ORIGIN = planMemberOrigin(loopWith([]));

  it("takes a group of the grid into the loop under the pointer", () => {
    const scene = mountGroupActions(
      planOf([
        sessionGroup({ x: 1500, y: 0, steps: [agentNode("a", "codex")] }),
        loopWith([]),
      ]),
    );

    scene.run((actions) =>
      actions.placeGroup("group", dropAt(ORIGIN.x + 40, ORIGIN.y + 30)),
    );

    expect(nodeIds(scene.draft())).toEqual(["loop"]);
    expect(loopOf(scene.draft()).steps).toEqual([
      expect.objectContaining({ id: "group", x: 40, y: 30 }),
    ]);
    expect(scene.actions().notice).toBeNull();
  });

  it("names the connections a group gives up when it enters a loop", () => {
    const scene = mountGroupActions(
      planOf(
        [
          sessionGroup({ x: 1500, y: 0, steps: [agentNode("a", "codex")] }),
          agentNode("other", "codex", { x: 1500, y: 600 }),
          loopWith([]),
        ],
        [flowEdge("a", "other")],
      ),
    );

    scene.run((actions) =>
      actions.placeGroup("group", dropAt(ORIGIN.x + 40, ORIGIN.y + 30)),
    );

    expect(scene.actions().notice).toEqual({
      kind: "moved",
      frame: "loop",
      removedEdges: 1,
      removedBindings: 0,
    });
    expect(scene.draft().edges).toEqual([]);
  });

  it("takes a group out of its loop onto the grid", () => {
    const nested = sessionGroup({
      id: "inner",
      steps: [agentNode("a", "codex")],
    });
    const scene = mountGroupActions(planOf([loopWith([nested])]));

    scene.run((actions) => actions.placeGroup("inner", dropAt(2000, 100)));

    expect(loopOf(scene.draft()).steps).toEqual([]);
    expect(scene.draft().nodes).toContainEqual(
      expect.objectContaining({ id: "inner", type: "group", x: 2000, y: 100 }),
    );
  });

  it("moves a group within its loop", () => {
    const nested = sessionGroup({ id: "inner" });
    const scene = mountGroupActions(planOf([loopWith([nested])]));

    scene.run((actions) =>
      actions.placeGroup("inner", dropAt(ORIGIN.x + 200, ORIGIN.y + 90)),
    );

    expect(stepOf(scene.draft(), "inner")).toMatchObject({ x: 200, y: 90 });
    expect(loopOf(scene.draft()).steps).toHaveLength(1);
  });

  it("leaves a collapsed loop under the pointer out of account", () => {
    const scene = mountGroupActions(
      planOf([sessionGroup({ x: 1500, y: 0 }), loopWith([])]),
    );

    scene.run((actions) =>
      actions.placeGroup("group", {
        ...dropAt(ORIGIN.x + 40, ORIGIN.y + 30),
        excludedGroups: new Set(["loop"]),
      }),
    );

    expect(loopOf(scene.draft()).steps).toEqual([]);
    expect(groupOf(scene.draft())).toMatchObject({
      x: ORIGIN.x + 40,
      y: ORIGIN.y + 30,
    });
  });

  it("ignores a group that is gone", () => {
    const initial = planOf([loopWith([])]);
    const scene = mountGroupActions(initial);

    scene.run((actions) => actions.placeGroup("ghost", dropAt(300, 300)));

    expect(scene.draft()).toBe(initial);
  });

  it("applies a queued move to the newest draft and drops it when the group is gone", () => {
    const initial = planOf([sessionGroup({ x: 1500, y: 0 }), loopWith([])]);
    const scene = mountRecordedActions(initial);

    scene.hook.result.current.actions.placeGroup(
      "group",
      dropAt(ORIGIN.x + 40, ORIGIN.y + 30),
    );
    const settled = scene.settle(initial);
    const gone = planOf([loopWith([])]);

    expect(loopOf(settled).steps.map((member) => member.id)).toEqual(["group"]);
    expect(scene.settle(gone)).toBe(gone);
  });
});

describe("joining a stack", () => {
  const STACK: AgentPlanStack = {
    id: "stack",
    type: "stack",
    name: "Queue",
    x: 0,
    y: 0,
    entries: [],
  };

  it("takes a value node into the stack as its last entry", () => {
    const scene = mountGroupActions(
      planOf([
        STACK,
        {
          id: "value",
          type: "parameter",
          name: "topic",
          format: "string",
          value: "kept",
          x: 500,
          y: 0,
        },
      ]),
    );

    scene.run((actions) => actions.joinStack("value", "stack"));

    expect(scene.draft().nodes).toEqual([
      expect.objectContaining({
        id: "stack",
        entries: [
          {
            id: "value",
            type: "parameter",
            name: "topic",
            format: "string",
            value: "kept",
          },
        ],
      }),
    ]);
    expect(scene.actions().notice).toBeNull();
  });

  it("names the bindings that read the value node directly", () => {
    const scene = mountGroupActions(
      planOf([
        STACK,
        {
          id: "task",
          type: "task",
          taskId: "task-1",
          x: 500,
          y: 0,
        },
        agentNode("a", "codex", {
          x: 900,
          bindings: { input1: { kind: "source", nodeId: "task" } },
        }),
      ]),
    );

    scene.run((actions) => actions.joinStack("task", "stack"));

    expect(scene.actions().notice).toEqual({
      kind: "moved",
      frame: "stack",
      removedEdges: 0,
      removedBindings: 1,
    });
    expect(stepOf(scene.draft(), "a")).toMatchObject({ bindings: {} });
  });

  it("refuses a node that is no entry and a stack that is gone", () => {
    const initial = planOf([STACK, agentNode("a", "codex")]);
    const scene = mountGroupActions(initial);

    scene.run((actions) => {
      actions.joinStack("a", "stack");
      actions.joinStack("a", "ghost");
    });

    expect(scene.draft()).toBe(initial);
    expect(scene.actions().notice).toBeNull();
  });

  it("drops a queued join when the stack was deleted meanwhile", () => {
    const initial = planOf([
      STACK,
      { id: "task", type: "task", taskId: "task-1", x: 500, y: 0 },
    ]);
    const scene = mountRecordedActions(initial);

    scene.hook.result.current.actions.joinStack("task", "stack");
    const withoutStack = planOf([
      { id: "task", type: "task", taskId: "task-1", x: 500, y: 0 },
    ]);

    expect(scene.settle(withoutStack)).toBe(withoutStack);
  });
});

describe("placing a decision", () => {
  const DECISION: AgentPlanDecision = {
    id: "decide",
    type: "decision",
    name: "Ready?",
    x: 1500,
    y: 0,
  };

  function groupDecisions(plan: AgentPlanInput): readonly AgentPlanDecision[] {
    return groupOf(plan).decisions ?? [];
  }

  it("takes a decision into the group under the pointer", () => {
    const scene = mountGroupActions(planOf([sessionGroup(), DECISION]));

    scene.run((actions) =>
      actions.place("decide", {
        pointer: { x: 300, y: 250 },
        position: { x: 250, y: 300 },
      }),
    );

    expect(groupDecisions(scene.draft())).toEqual([
      expect.objectContaining({
        id: "decide",
        x: 250 - PLAN_FRAME_PADDING,
        y: 300 - planGroupHeaderHeight(),
      }),
    ]);
    expect(nodeIds(scene.draft())).toEqual(["group"]);
    expect(scene.actions().notice).toBeNull();
  });

  it("takes a decision out of its group onto the grid", () => {
    const scene = mountGroupActions(
      planOf([sessionGroup({ decisions: [{ ...DECISION, x: 5, y: 6 }] })]),
    );

    scene.run((actions) => actions.place("decide", dropAt(1500, 40)));

    expect(groupDecisions(scene.draft())).toEqual([]);
    expect(scene.draft().nodes).toContainEqual(
      expect.objectContaining({ id: "decide", x: 1500, y: 40 }),
    );
  });

  it("keeps a decision outside a collapsed group", () => {
    const scene = mountGroupActions(planOf([sessionGroup(), DECISION]));

    scene.run((actions) =>
      actions.place("decide", {
        ...dropAt(300, 250),
        excludedGroups: new Set(["group"]),
      }),
    );

    expect(groupDecisions(scene.draft())).toEqual([]);
    expect(scene.draft().nodes).toContainEqual(
      expect.objectContaining({ id: "decide", x: 300, y: 250 }),
    );
  });

  it("refuses to cut the condition connection of a decision that changes its frame", () => {
    const initial = planOf(
      [sessionGroup(), DECISION, agentNode("a", "codex", { x: 1500, y: 600 })],
      [
        {
          from: "a",
          to: "decide",
          fromPort: "passed-out",
          toPort: "condition-in",
        },
      ],
    );
    const scene = mountGroupActions(initial);

    scene.run((actions) => actions.place("decide", dropAt(300, 250)));

    expect(scene.actions().notice).toEqual({ kind: "repair", name: "Ready?" });
    expect(scene.draft()).toBe(initial);
  });
});
