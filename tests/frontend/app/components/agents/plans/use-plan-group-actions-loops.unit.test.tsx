import { describe, expect, it } from "vitest";

import { planMemberOrigin } from "@/app/components/agents/plans/plan-layout";

import {
  agentNode,
  flowEdge,
  planOf,
  scriptNode,
  sessionGroup,
} from "./plan-group-fixture";
import {
  dropAt,
  loopWith,
  mountGroupActions,
  mountRecordedActions,
  stepOf,
} from "./use-plan-group-actions-fixture";

import type { AgentPlanInput } from "@/definition/AgentPlan";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";

const LOOP_ORIGIN = planMemberOrigin(loopWith([]));
// A point inside the empty loop at the grid position of its member area.
const INSIDE_LOOP = { x: LOOP_ORIGIN.x + 200, y: LOOP_ORIGIN.y + 80 };

function loopOf(plan: AgentPlanInput): AgentPlanLoop {
  const loop = plan.nodes.find(
    (node): node is AgentPlanLoop => node.type === "loop",
  );
  if (!loop) throw new Error("No loop in the plan");
  return loop;
}

function memberIds(plan: AgentPlanInput): string[] {
  return loopOf(plan).steps.map((member) => member.id);
}

describe("placing an agent into or out of a loop", () => {
  it("counts the position of an agent that enters a loop from the loop's member area", () => {
    const scene = mountGroupActions(
      planOf([agentNode("a", "codex", { x: 1200, y: 0 }), loopWith([])]),
    );

    scene.run((actions) =>
      actions.place("a", dropAt(INSIDE_LOOP.x, INSIDE_LOOP.y)),
    );

    expect(stepOf(scene.draft(), "a")).toMatchObject({ x: 200, y: 80 });
    expect(memberIds(scene.draft())).toEqual(["a"]);
    expect(scene.draft().nodes.map((node) => node.id)).toEqual(["loop"]);
    expect(scene.actions().notice).toBeNull();
  });

  it("moves a member within its loop", () => {
    const scene = mountGroupActions(
      planOf([loopWith([agentNode("a", "codex", { x: 0, y: 0 })])]),
    );

    scene.run((actions) =>
      actions.place("a", dropAt(LOOP_ORIGIN.x + 300, LOOP_ORIGIN.y + 120)),
    );

    expect(stepOf(scene.draft(), "a")).toMatchObject({ x: 300, y: 120 });
    expect(memberIds(scene.draft())).toEqual(["a"]);
  });

  it("takes a member out of its loop onto the outer grid", () => {
    const scene = mountGroupActions(
      planOf([loopWith([agentNode("a", "codex")])]),
    );

    scene.run((actions) => actions.place("a", dropAt(1500, 100)));

    expect(memberIds(scene.draft())).toEqual([]);
    expect(stepOf(scene.draft(), "a")).toMatchObject({ x: 1500, y: 100 });
    expect(scene.actions().notice).toBeNull();
  });
});

describe("refusing a move that would cut a loop's connections", () => {
  it("refuses to leave a loop with the flow edges of a member and says so", () => {
    const initial = planOf([
      loopWith([agentNode("a", "codex"), agentNode("b", "codex", { x: 400 })], {
        edges: [flowEdge("a", "b")],
      }),
    ]);
    const scene = mountGroupActions(initial);

    scene.run((actions) => actions.place("a", dropAt(1500, 100)));

    expect(scene.actions().notice).toEqual({
      kind: "repair",
      name: "Codex One",
    });
    expect(scene.draft()).toBe(initial);
  });

  it("refuses to leave a loop whose end condition reads the member", () => {
    const initial = planOf([
      loopWith([agentNode("a", "codex")], {
        condition: {
          isEnabled: true,
          sourceNodeId: "a",
          outputPath: "$.end",
          operator: "equals",
          expected: { type: "boolean", value: true },
        },
      }),
    ]);
    const scene = mountGroupActions(initial);

    scene.run((actions) => actions.place("a", dropAt(1500, 100)));

    expect(scene.actions().notice).toMatchObject({ kind: "repair" });
    expect(scene.draft()).toBe(initial);
  });

  it("refuses to enter a loop with the flow edges of an agent of the grid", () => {
    const initial = planOf(
      [
        agentNode("a", "codex", { x: 1200, y: 0 }),
        agentNode("b", "codex", { x: 1200, y: 400 }),
        loopWith([]),
      ],
      [flowEdge("a", "b")],
    );
    const scene = mountGroupActions(initial);

    scene.run((actions) =>
      actions.place("a", dropAt(INSIDE_LOOP.x, INSIDE_LOOP.y)),
    );

    expect(scene.actions().notice).toEqual({
      kind: "repair",
      name: "Codex One",
    });
    expect(scene.draft()).toBe(initial);
  });
});

describe("placing a member of a group in a loop", () => {
  it("takes a member of a group into a loop and out of its group", () => {
    const scene = mountGroupActions(
      planOf([
        sessionGroup({ steps: [agentNode("a", "codex")] }),
        loopWith([], { y: 1000 }),
      ]),
    );
    const origin = planMemberOrigin(loopWith([], { y: 1000 }));

    scene.run((actions) =>
      actions.place("a", dropAt(origin.x + 150, origin.y + 60)),
    );

    const group = scene
      .draft()
      .nodes.find((node): node is AgentPlanGroup => node.type === "group");
    expect(group?.steps).toEqual([]);
    expect(memberIds(scene.draft())).toEqual(["a"]);
    expect(stepOf(scene.draft(), "a")).toMatchObject({ x: 150, y: 60 });
  });

  it("moves an agent of a group inside a loop within that group only", () => {
    const nested = sessionGroup({
      id: "inner",
      x: 10,
      y: 20,
      steps: [agentNode("a", "codex")],
    });
    const scene = mountGroupActions(planOf([loopWith([nested])]));
    const groupOrigin = planMemberOrigin({ ...nested, x: 0, y: 0 });

    scene.run((actions) =>
      actions.place("a", {
        // The pointer is far off: the member stays in its group wherever it is dropped.
        pointer: { x: 3000, y: 3000 },
        position: {
          x: LOOP_ORIGIN.x + 10 + groupOrigin.x + 150,
          y: LOOP_ORIGIN.y + 20 + groupOrigin.y + 60,
        },
      }),
    );

    expect(stepOf(scene.draft(), "a")).toMatchObject({ x: 150, y: 60 });
    expect(memberIds(scene.draft())).toEqual(["inner"]);
    expect(scene.actions().notice).toBeNull();
  });

  it("clears the notice of an earlier refusal after moving a nested member", () => {
    const nested = sessionGroup({
      id: "inner",
      steps: [agentNode("a", "codex")],
    });
    const scene = mountGroupActions(planOf([loopWith([nested])]));
    scene.run((actions) =>
      actions.refuse("otherAdapter", agentNode("a", "codex"), nested),
    );

    scene.run((actions) =>
      actions.place("a", dropAt(LOOP_ORIGIN.x + 90, LOOP_ORIGIN.y + 200)),
    );

    expect(scene.actions().notice).toBeNull();
  });

  it("moves a script of a loop out onto the grid", () => {
    const scene = mountGroupActions(planOf([loopWith([scriptNode("s", 0)])]));

    scene.run((actions) => actions.place("s", dropAt(1500, 300)));

    expect(memberIds(scene.draft())).toEqual([]);
    expect(scene.draft().nodes).toContainEqual(
      expect.objectContaining({ id: "s", type: "script", x: 1500, y: 300 }),
    );
  });

  it("keeps a script of the grid exactly once when it is dropped onto a group", () => {
    const scene = mountGroupActions(
      planOf([sessionGroup(), scriptNode("s", 0)]),
    );

    scene.run((actions) => actions.place("s", dropAt(300, 250)));

    const scripts = scene.draft().nodes.filter((node) => node.id === "s");
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toMatchObject({ x: 300, y: 250 });
    expect(scene.actions().notice).toBeNull();
  });
});

describe("placing into a loop while the draft changes", () => {
  it("drops a queued loop move of a node that was deleted meanwhile", () => {
    const initial = planOf([loopWith([agentNode("a", "codex")])]);
    const scene = mountRecordedActions(initial);

    scene.hook.result.current.actions.place("a", dropAt(1500, 100));
    const emptied = planOf([loopWith([])]);

    expect(scene.settle(emptied)).toBe(emptied);
  });

  it("drops a queued loop move when the pointer's frame changed meanwhile", () => {
    const initial = planOf([
      agentNode("a", "codex", { x: 1200 }),
      loopWith([]),
    ]);
    const scene = mountRecordedActions(initial);

    scene.hook.result.current.actions.place(
      "a",
      dropAt(INSIDE_LOOP.x, INSIDE_LOOP.y),
    );
    const loopMoved = planOf([
      agentNode("a", "codex", { x: 1200 }),
      loopWith([], { x: 3000 }),
    ]);

    expect(scene.settle(loopMoved)).toBe(loopMoved);
  });

  it("drops a queued loop move that would now cut a connection", () => {
    const initial = planOf([
      agentNode("a", "codex", { x: 1200 }),
      loopWith([]),
    ]);
    const scene = mountRecordedActions(initial);

    scene.hook.result.current.actions.place(
      "a",
      dropAt(INSIDE_LOOP.x, INSIDE_LOOP.y),
    );
    const connected = planOf(
      [
        agentNode("a", "codex", { x: 1200 }),
        agentNode("b", "codex", { x: 1200, y: 400 }),
        loopWith([]),
      ],
      [flowEdge("a", "b")],
    );

    expect(scene.settle(connected)).toBe(connected);
  });

  it("drops a queued move of a nested member that was deleted meanwhile", () => {
    const nested = sessionGroup({
      id: "inner",
      steps: [agentNode("a", "codex")],
    });
    const scene = mountRecordedActions(planOf([loopWith([nested])]));

    scene.hook.result.current.actions.place(
      "a",
      dropAt(LOOP_ORIGIN.x + 90, LOOP_ORIGIN.y + 200),
    );
    const emptied = planOf([loopWith([sessionGroup({ id: "inner" })])]);

    expect(scene.settle(emptied)).toBe(emptied);
  });

  it("applies a queued loop move to the newest draft", () => {
    const initial = planOf([
      agentNode("a", "codex", { x: 1200 }),
      loopWith([]),
    ]);
    const scene = mountRecordedActions(initial);

    scene.hook.result.current.actions.place(
      "a",
      dropAt(INSIDE_LOOP.x, INSIDE_LOOP.y),
    );
    const settled = scene.settle(
      planOf([
        agentNode("a", "codex", { x: 1200 }),
        agentNode("other", "codex", { x: 5, y: 6 }),
        loopWith([]),
      ]),
    );

    expect(memberIds(settled)).toEqual(["a"]);
    expect(stepOf(settled, "other")).toMatchObject({ x: 5, y: 6 });
  });
});
