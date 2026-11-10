import { describe, expect, it } from "vitest";

import {
  PLAN_FRAME_PADDING,
  planGroupHeaderHeight,
} from "@/app/components/agents/plans/plan-layout";

import {
  agentNode,
  flowEdge,
  ownCopy,
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

import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { AgentPlanNode } from "@/definition/AgentPlan";

const MEMBER_X = PLAN_FRAME_PADDING;
const MEMBER_Y = planGroupHeaderHeight();

function nodeIds(nodes: readonly AgentPlanNode[]): string[] {
  return nodes.map((node) => node.id);
}

function groupOf(
  plan: ReturnType<typeof planOf>,
  id = "group",
): AgentPlanGroup {
  const group = plan.nodes.find(
    (node): node is AgentPlanGroup => node.type === "group" && node.id === id,
  );
  if (!group) throw new Error(`No group ${id}`);
  return group;
}

describe("placing an agent on the grid", () => {
  it("moves an agent outside every frame to the bounded drop position", () => {
    const scene = mountGroupActions(
      planOf([agentNode("a", "codex", { x: 10, y: 10 })]),
    );

    scene.run((actions) =>
      actions.place("a", {
        pointer: { x: 900, y: 900 },
        position: { x: 900.4, y: 7000 },
      }),
    );

    expect(stepOf(scene.draft(), "a")).toMatchObject({ x: 900, y: 6000 });
    expect(scene.actions().notice).toBeNull();
  });

  it("clears an earlier notice when an agent only moves", () => {
    const scene = mountGroupActions(planOf([agentNode("a", "codex")]));
    const step = agentNode("a", "codex");
    scene.run((actions) =>
      actions.refuse("otherAdapter", step, sessionGroup()),
    );
    expect(scene.actions().notice).not.toBeNull();

    scene.run((actions) => actions.place("a", dropAt(500, 500)));

    expect(scene.actions().notice).toBeNull();
  });

  it("ignores a drop of an agent that is gone", () => {
    const initial = planOf([agentNode("a", "codex")]);
    const scene = mountGroupActions(initial);

    scene.run((actions) => actions.place("ghost", dropAt(300, 300)));

    expect(scene.draft()).toBe(initial);
  });

  it("takes an agent dropped onto a group as its member, counted from the member area", () => {
    const scene = mountGroupActions(
      planOf([sessionGroup(), agentNode("a", "codex", { x: 1200, y: 0 })]),
    );

    scene.run((actions) =>
      actions.place("a", {
        pointer: { x: 300, y: 200 },
        position: { x: 150, y: 250 },
      }),
    );

    const group = groupOf(scene.draft());
    expect(group.steps).toEqual([
      expect.objectContaining({
        id: "a",
        x: 150 - MEMBER_X,
        y: 250 - MEMBER_Y,
      }),
    ]);
    expect(nodeIds(scene.draft().nodes)).toEqual(["group"]);
    expect(scene.actions().notice).toBeNull();
  });

  it("moves a member within its group without leaving it", () => {
    const scene = mountGroupActions(
      planOf([
        sessionGroup({
          steps: [agentNode("a", "codex", { x: 0, y: 0 })],
        }),
      ]),
    );

    scene.run((actions) =>
      actions.place("a", {
        pointer: { x: 400, y: 250 },
        position: { x: 220, y: 300 },
      }),
    );

    expect(groupOf(scene.draft()).steps).toEqual([
      expect.objectContaining({
        id: "a",
        x: 220 - MEMBER_X,
        y: 300 - MEMBER_Y,
      }),
    ]);
    expect(scene.actions().notice).toBeNull();
  });

  it("takes a member out of its group when the pointer leaves the frame", () => {
    const scene = mountGroupActions(
      planOf([sessionGroup({ steps: [agentNode("a", "codex")] })]),
    );

    scene.run((actions) => actions.place("a", dropAt(1500, 40)));

    expect(groupOf(scene.draft()).steps).toEqual([]);
    expect(stepOf(scene.draft(), "a")).toMatchObject({ x: 1500, y: 40 });
  });

  it("keeps the flow of a member that leaves its group as an outer edge", () => {
    const scene = mountGroupActions(
      planOf([
        sessionGroup({
          steps: [agentNode("a", "codex"), agentNode("b", "codex")],
          edges: [flowEdge("a", "b")],
        }),
      ]),
    );

    scene.run((actions) => actions.place("b", dropAt(1500, 40)));

    expect(scene.draft().edges).toEqual([flowEdge("a", "b")]);
    expect(groupOf(scene.draft()).edges).toEqual([]);
    expect(scene.actions().notice).toBeNull();
  });

  it("ignores a collapsed group under the pointer", () => {
    const scene = mountGroupActions(
      planOf([sessionGroup(), agentNode("a", "codex", { x: 1200, y: 0 })]),
    );

    scene.run((actions) =>
      actions.place("a", {
        ...dropAt(300, 200),
        excludedGroups: new Set(["group"]),
      }),
    );

    expect(groupOf(scene.draft()).steps).toEqual([]);
    expect(stepOf(scene.draft(), "a")).toMatchObject({ x: 300, y: 200 });
  });

  it("refuses an agent of another adapter and names both adapters", () => {
    const initial = planOf([
      sessionGroup({ steps: [agentNode("a", "codex")] }),
      agentNode("b", "claude", { x: 1200, y: 0 }),
    ]);
    const scene = mountGroupActions(initial);

    scene.run((actions) => actions.place("b", dropAt(300, 250)));

    expect(scene.draft()).toBe(initial);
    expect(scene.actions().notice).toEqual({
      kind: "refused",
      refusal: "otherAdapter",
      name: "Claude",
      adapter: "claude_code",
      groupAdapter: "codex_cli",
    });
  });

  it("refuses an API agent that no ACP session can run", () => {
    const scene = mountGroupActions(
      planOf([sessionGroup(), agentNode("b", "api", { x: 1200, y: 0 })]),
    );

    scene.run((actions) => actions.place("b", dropAt(300, 250)));

    expect(scene.actions().notice).toMatchObject({
      kind: "refused",
      refusal: "notAcp",
      name: "Api",
      adapter: null,
      groupAdapter: null,
    });
    expect(groupOf(scene.draft()).steps).toEqual([]);
  });

  it("keeps the connection of an agent that joins a group", () => {
    const scene = mountGroupActions(
      planOf(
        [
          sessionGroup({ steps: [agentNode("m", "codex")] }),
          agentNode("a", "codex", { x: 1200, y: 0 }),
          agentNode("b", "codex", { x: 1200, y: 400 }),
        ],
        [flowEdge("a", "b")],
      ),
    );

    scene.run((actions) => actions.place("a", dropAt(300, 250)));

    expect(groupOf(scene.draft()).steps.map((step) => step.id)).toEqual([
      "m",
      "a",
    ]);
    expect(scene.draft().edges).toEqual([flowEdge("a", "b")]);
    expect(scene.actions().notice).toBeNull();
  });

  it("refuses to leave a group when an input still reads a port of it", () => {
    const initial = planOf([
      sessionGroup({
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
        steps: [
          agentNode("a", "codex", {
            bindings: { input1: { kind: "source", nodeId: "port" } },
          }),
        ],
      }),
    ]);
    const scene = mountGroupActions(initial);

    scene.run((actions) => actions.place("a", dropAt(1500, 40)));

    expect(scene.actions().notice).toEqual({
      kind: "repair",
      name: "Codex One",
    });
    expect(scene.draft()).toBe(initial);
  });

  it("names a node by its own copy when it is refused", () => {
    const scene = mountGroupActions(
      planOf([
        sessionGroup({ steps: [agentNode("a", "codex")] }),
        agentNode("b", "claude", {
          x: 1200,
          y: 0,
          configuration: { ...ownCopy("Pinned", 0), provider: "claude_code" },
        }),
      ]),
    );
    scene.run((actions) => actions.place("b", dropAt(300, 250)));
    expect(scene.actions().notice).toMatchObject({ name: "Pinned" });
  });
});

describe("placing a node that was changed meanwhile", () => {
  it("moves the member of the newest draft, keeping a concurrent edit", () => {
    const initial = planOf([
      sessionGroup({ steps: [agentNode("a", "codex")] }),
      agentNode("other", "codex", { x: 900, y: 900 }),
    ]);
    const scene = mountRecordedActions(initial);

    scene.hook.result.current.actions.place("a", dropAt(400, 250));
    const concurrent = planOf([
      sessionGroup({ steps: [agentNode("a", "codex")] }),
      agentNode("other", "codex", { x: 1, y: 2 }),
    ]);
    const settled = scene.settle(concurrent);

    expect(stepOf(settled, "other")).toMatchObject({ x: 1, y: 2 });
    expect(stepOf(settled, "a")).toMatchObject({ x: 400 - MEMBER_X });
  });

  it("drops a queued move of a member that was deleted meanwhile", () => {
    const initial = planOf([
      sessionGroup({ steps: [agentNode("a", "codex")] }),
    ]);
    const scene = mountRecordedActions(initial);

    scene.hook.result.current.actions.place("a", dropAt(400, 250));
    const emptied = planOf([sessionGroup()]);

    expect(scene.settle(emptied)).toBe(emptied);
  });

  it("drops a queued move of a member that another frame took meanwhile", () => {
    const initial = planOf([
      sessionGroup({ steps: [agentNode("a", "codex")] }),
    ]);
    const scene = mountRecordedActions(initial);

    scene.hook.result.current.actions.place("a", dropAt(400, 250));
    const outside = planOf([sessionGroup(), agentNode("a", "codex")]);

    expect(scene.settle(outside)).toBe(outside);
  });

  it("drops a queued move out of a group when the newest draft binds the member to a port", () => {
    const port = {
      id: "port",
      name: "topic",
      type: "text" as const,
      description: "",
      isRequired: false,
      defaultValue: null,
    };
    const initial = planOf([
      sessionGroup({ parameters: [port], steps: [agentNode("a", "codex")] }),
    ]);
    const scene = mountRecordedActions(initial);

    scene.hook.result.current.actions.place("a", dropAt(1500, 40));
    const bound = planOf([
      sessionGroup({
        parameters: [port],
        steps: [
          agentNode("a", "codex", {
            bindings: { input1: { kind: "source", nodeId: "port" } },
          }),
        ],
      }),
    ]);

    expect(scene.settle(bound)).toBe(bound);
  });

  it("enters the group of the newest draft when it still admits the agent", () => {
    const initial = planOf([
      sessionGroup(),
      agentNode("a", "codex", { x: 1200, y: 0 }),
    ]);
    const scene = mountRecordedActions(initial);

    scene.hook.result.current.actions.place("a", dropAt(300, 250));
    const settled = scene.settle(initial);

    expect(groupOf(settled).steps.map((step) => step.id)).toEqual(["a"]);
  });
});

describe("assigning an agent from a form", () => {
  it("appends the agent after the right edge of the members", () => {
    const scene = mountGroupActions(
      planOf([
        sessionGroup({
          steps: [agentNode("m", "codex", { x: 100, y: 40 })],
        }),
        agentNode("a", "codex", { x: 1200, y: 0 }),
      ]),
    );

    scene.run((actions) => actions.assign("a", "group"));

    expect(
      groupOf(scene.draft()).steps.map((step) => [step.id, step.x, step.y]),
    ).toEqual([
      ["m", 100, 40],
      ["a", 420, 0],
    ]);
  });

  it("puts the first member of an empty group at the left edge of its member area", () => {
    const scene = mountGroupActions(
      planOf([sessionGroup(), agentNode("a", "codex", { x: 1200, y: 0 })]),
    );

    scene.run((actions) => actions.assign("a", "group"));

    expect(groupOf(scene.draft()).steps).toEqual([
      expect.objectContaining({ id: "a", x: 0, y: 0 }),
    ]);
  });

  it("moves a member out of its group to where the frame showed it", () => {
    const scene = mountGroupActions(
      planOf([
        sessionGroup({
          x: 100,
          y: 200,
          steps: [agentNode("a", "codex", { x: 30, y: 40 })],
        }),
      ]),
    );

    scene.run((actions) => actions.assign("a", null));

    expect(groupOf(scene.draft()).steps).toEqual([]);
    expect(stepOf(scene.draft(), "a")).toMatchObject({
      x: 100 + MEMBER_X + 30,
      y: 200 + MEMBER_Y + 40,
    });
  });

  it("keeps the position of an agent that stays outside every frame", () => {
    const initial = planOf([agentNode("a", "codex", { x: 10, y: 20 })]);
    const scene = mountGroupActions(initial);

    scene.run((actions) => actions.assign("a", null));

    expect(scene.draft()).toBe(initial);
  });

  it("does nothing for an agent that already is a member of the group", () => {
    const initial = planOf([
      sessionGroup({ steps: [agentNode("a", "codex")] }),
    ]);
    const scene = mountGroupActions(initial);

    scene.run((actions) => actions.assign("a", "group"));

    expect(scene.draft()).toBe(initial);
  });

  it("does nothing for an agent or a group that does not exist", () => {
    const initial = planOf([sessionGroup(), agentNode("a", "codex")]);
    const scene = mountGroupActions(initial);

    scene.run((actions) => {
      actions.assign("ghost", "group");
      actions.assign("a", "ghost");
    });

    expect(scene.draft()).toBe(initial);
    expect(scene.actions().notice).toBeNull();
  });

  it("tells why a group refuses the agent", () => {
    const scene = mountGroupActions(
      planOf([
        sessionGroup({ steps: [agentNode("m", "codex")] }),
        agentNode("a", "claude"),
      ]),
    );

    scene.run((actions) => actions.assign("a", "group"));

    expect(scene.actions().notice).toMatchObject({
      kind: "refused",
      refusal: "otherAdapter",
      name: "Claude",
    });
    expect(groupOf(scene.draft()).steps.map((step) => step.id)).toEqual(["m"]);
  });

  it("places the agent by the newest draft of the editor when it offers one", () => {
    const initial = planOf([
      sessionGroup(),
      agentNode("a", "codex", { x: 1200, y: 0 }),
    ]);
    const newest = planOf([
      sessionGroup({ steps: [agentNode("m", "codex", { x: 100, y: 40 })] }),
      agentNode("a", "codex", { x: 1200, y: 0 }),
    ]);
    const scene = mountGroupActions(initial, { currentDraft: () => newest });

    scene.run((actions) => actions.assign("a", "group"));

    // The slot lies right of the member that only the newest draft has.
    expect(groupOf(scene.draft()).steps).toEqual([
      expect.objectContaining({ id: "a", x: 420, y: 0 }),
    ]);
  });
});

describe("telling why a group refused an agent", () => {
  it("shows the refusal with the adapters and name of both sides", () => {
    const scene = mountGroupActions(planOf([]));
    const group = sessionGroup({ steps: [agentNode("m", "codex")] });

    scene.run((actions) =>
      actions.refuse("notAcp", agentNode("b", "api"), group),
    );

    expect(scene.actions().notice).toEqual({
      kind: "refused",
      refusal: "notAcp",
      name: "Api",
      adapter: null,
      groupAdapter: "codex_cli",
    });
  });

  it("clears the notice on request", () => {
    const scene = mountGroupActions(planOf([]));
    scene.run((actions) =>
      actions.refuse("otherAdapter", agentNode("b", "claude"), sessionGroup()),
    );

    scene.run((actions) => actions.clearNotice());

    expect(scene.actions().notice).toBeNull();
  });
});

describe("placing a script", () => {
  it("moves a script of the outer grid within it", () => {
    const scene = mountGroupActions(planOf([scriptNode("s", 0)]));

    scene.run((actions) => actions.place("s", dropAt(600, 700)));

    expect(scene.draft().nodes).toEqual([
      expect.objectContaining({ id: "s", x: 600, y: 700 }),
    ]);
  });
});

describe("placing into a loop", () => {
  it("takes an agent of the grid into the loop under the pointer", () => {
    const scene = mountGroupActions(
      planOf([agentNode("a", "codex", { x: 1200, y: 0 }), loopWith([])]),
    );

    scene.run((actions) =>
      actions.place("a", {
        pointer: { x: 300, y: 900 },
        position: { x: 120, y: 900 },
      }),
    );

    const loop = scene.draft().nodes.find((node) => node.type === "loop");
    expect(loop).toMatchObject({
      steps: [
        expect.objectContaining({
          id: "a",
          x: 120 - MEMBER_X,
          y: 900 - (640 + planGroupHeaderHeight(loopWith([]))),
        }),
      ],
    });
    expect(nodeIds(scene.draft().nodes)).toEqual(["loop"]);
    expect(scene.actions().notice).toBeNull();
  });
});
