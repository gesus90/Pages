import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePlanFlowMovement } from "@/app/components/agents/plans/use-plan-flow-movement";
import {
  PLAN_FRAME_PADDING,
  planGroupHeaderHeight,
  planMemberOrigin,
} from "@/app/components/agents/plans/plan-layout";

import {
  GROUP_SOURCES,
  agentNode,
  graphStub,
  planOf,
  sessionGroup,
} from "./plan-group-fixture";
import { loopWith } from "./use-plan-group-actions-fixture";

import type { NodeChange } from "@xyflow/react";
import type { PlanFlowNode } from "@/app/components/agents/plans/plan-flow-model";
import type { PlanGraphActions } from "@/app/components/agents/plans/use-plan-graph";
import type { AgentPlanInput, AgentPlanNode } from "@/definition/AgentPlan";

const flow = vi.hoisted(() => ({
  screenToFlowPosition: vi.fn((point: { x: number; y: number }) => ({
    x: point.x - 1000,
    y: point.y - 2000,
  })),
}));

vi.mock("@xyflow/react", () => ({ useReactFlow: () => flow }));

const GROUP = sessionGroup({
  x: 100,
  y: 200,
  steps: [agentNode("member", "codex", { x: 30, y: 40 })],
});
const LOOP = loopWith(
  [
    sessionGroup({
      id: "inner",
      x: 15,
      y: 25,
      steps: [agentNode("deep", "codex", { x: 5, y: 6 })],
    }),
  ],
  { y: 1000 },
);

function plan(...extra: AgentPlanNode[]): AgentPlanInput {
  return planOf([
    { id: "start", type: "start", x: 0, y: 0 },
    GROUP,
    LOOP,
    {
      id: "stack",
      type: "stack",
      name: "Queue",
      x: 2000,
      y: 0,
      entries: [],
    },
    { id: "task", type: "task", taskId: "task-1", x: 2400, y: 600 },
    {
      id: "value",
      type: "parameter",
      name: "topic",
      format: "string",
      value: "kept",
      x: 2400,
      y: 900,
    },
    agentNode("outer", "codex", { x: 1500, y: 400 }),
    ...extra,
  ]);
}

interface Mounted {
  readonly graph: PlanGraphActions;
  readonly movement: () => ReturnType<typeof usePlanFlowMovement>;
  readonly node: (id: string) => PlanFlowNode;
  rerender(options: { canEdit?: boolean; collapsed?: string[] }): void;
  unmount(): void;
}

function mount(
  options: {
    canEdit?: boolean;
    collapsed?: string[];
    draft?: AgentPlanInput;
  } = {},
): Mounted {
  const graph = graphStub();
  const draft = options.draft ?? plan();
  const hook = renderHook(
    (props: { canEdit: boolean; collapsed: string[] }) =>
      usePlanFlowMovement({
        draft,
        sources: GROUP_SOURCES,
        graph,
        canEdit: props.canEdit,
        collapsedGroups: new Set(props.collapsed),
      }),
    {
      initialProps: {
        canEdit: options.canEdit ?? true,
        collapsed: options.collapsed ?? [],
      },
    },
  );
  vi.mocked(graph.registerPendingMove).mockClear();
  const movement = (): ReturnType<typeof usePlanFlowMovement> =>
    hook.result.current;
  return {
    graph,
    movement,
    node: (id) => {
      const found = movement().nodes.find((entry) => entry.id === id);
      if (!found) throw new Error(`No flow node ${id}`);
      return found;
    },
    rerender: (next) =>
      hook.rerender({
        canEdit: next.canEdit ?? options.canEdit ?? true,
        collapsed: next.collapsed ?? options.collapsed ?? [],
      }),
    unmount: hook.unmount,
  };
}

function position(
  id: string,
  at: { x: number; y: number },
  dragging?: boolean,
): NodeChange<PlanFlowNode> {
  return { type: "position", id, position: at, dragging };
}

function mouse(x: number, y: number): MouseEvent {
  return new MouseEvent("mouseup", { clientX: x, clientY: y });
}

function touch(x: number, y: number): TouchEvent {
  return {
    changedTouches: [{ clientX: x, clientY: y }],
  } as unknown as TouchEvent;
}

function drag(
  scene: Mounted,
  id: string,
  event: MouseEvent | TouchEvent,
  at?: { x: number; y: number },
): void {
  const node = at ? { ...scene.node(id), position: at } : scene.node(id);
  act(() => scene.movement().onNodeDragStop(event, node, [node]));
}

beforeEach(() => {
  flow.screenToFlowPosition.mockClear();
});

describe("projecting the nodes of the plan", () => {
  it("shows every node and member of the draft, editable for a person who may edit", () => {
    const scene = mount();

    expect(scene.movement().nodes.map((node) => node.id)).toEqual([
      "start",
      "group",
      "member",
      "loop",
      "inner",
      "deep",
      "stack",
      "task",
      "value",
      "outer",
    ]);
    expect(scene.node("outer")).toMatchObject({
      position: { x: 1500, y: 400 },
      draggable: true,
    });
    expect(scene.movement().dropTarget).toBeNull();
  });

  it("keeps the measured size of a card across later projections", () => {
    const scene = mount();

    act(() =>
      scene.movement().onNodesChange([
        {
          type: "dimensions",
          id: "outer",
          dimensions: { width: 321, height: 456 },
        },
      ]),
    );

    expect(scene.node("outer").measured).toEqual({ width: 321, height: 456 });
    expect(scene.node("start").measured).toBeUndefined();
  });
});

describe("changes reported by the canvas", () => {
  it("selects a node that React Flow selects and ignores a deselection", () => {
    const scene = mount();

    act(() =>
      scene.movement().onNodesChange([
        { type: "select", id: "outer", selected: false },
        { type: "select", id: "start", selected: true },
      ]),
    );

    expect(scene.graph.select).toHaveBeenCalledTimes(1);
    expect(scene.graph.select).toHaveBeenCalledWith("start");
  });

  it("saves a finished move of a free card at its position", () => {
    const scene = mount();

    act(() =>
      scene.movement().onNodesChange([position("outer", { x: 1600, y: 450 })]),
    );

    expect(scene.graph.move).toHaveBeenCalledWith("outer", 1600, 450);
    expect(scene.graph.registerPendingMove).not.toHaveBeenCalled();
  });

  it("saves the position of a member counted from its frame's member area", () => {
    const scene = mount();

    act(() =>
      scene.movement().onNodesChange([
        position("member", {
          x: PLAN_FRAME_PADDING + 70,
          y: planGroupHeaderHeight() + 90,
        }),
      ]),
    );

    expect(scene.graph.move).toHaveBeenCalledWith("member", 70, 90);
  });

  it("counts the position of an agent of a group inside a loop from the group", () => {
    const scene = mount();

    act(() =>
      scene.movement().onNodesChange([
        position("deep", {
          x: PLAN_FRAME_PADDING + 11,
          y: planGroupHeaderHeight(GROUP) + 12,
        }),
      ]),
    );

    expect(scene.graph.move).toHaveBeenCalledWith("deep", 11, 12);
  });

  it("keeps a move in flight pending and shows the card where it is dragged", () => {
    const scene = mount();

    act(() =>
      scene
        .movement()
        .onNodesChange([position("outer", { x: 1700, y: 480 }, true)]),
    );

    expect(scene.graph.registerPendingMove).toHaveBeenCalledWith({
      id: "outer",
      x: 1700,
      y: 480,
    });
    expect(scene.graph.move).not.toHaveBeenCalled();
    expect(scene.node("outer").position).toEqual({ x: 1700, y: 480 });
  });

  it("ignores moves from a person who may not edit", () => {
    const scene = mount({ canEdit: false });

    act(() =>
      scene
        .movement()
        .onNodesChange([
          position("outer", { x: 1700, y: 480 }),
          position("outer", { x: 1800, y: 500 }, true),
        ]),
    );

    expect(scene.graph.move).not.toHaveBeenCalled();
    expect(scene.graph.registerPendingMove).not.toHaveBeenCalled();
    expect(scene.node("outer").position).toEqual({ x: 1500, y: 400 });
  });

  it("ignores a change without a position or for a node that is gone", () => {
    const scene = mount();

    act(() =>
      scene
        .movement()
        .onNodesChange([
          { type: "position", id: "outer" },
          position("ghost", { x: 1, y: 2 }),
        ]),
    );

    expect(scene.graph.move).not.toHaveBeenCalled();
    expect(scene.graph.registerPendingMove).not.toHaveBeenCalled();
  });
});

describe("dragging a card", () => {
  it("registers the start of a drag as a pending move of the stored position", () => {
    const scene = mount();
    const member = scene.node("member");

    act(() => scene.movement().onNodeDragStart(mouse(0, 0), member, [member]));

    expect(scene.graph.registerPendingMove).toHaveBeenCalledWith({
      id: "member",
      x: member.position.x - PLAN_FRAME_PADDING,
      y: member.position.y - planGroupHeaderHeight(),
    });
  });

  it("treats every position change after the start of a drag as part of it", () => {
    const scene = mount();
    const outer = scene.node("outer");
    act(() => scene.movement().onNodeDragStart(mouse(0, 0), outer, [outer]));
    vi.mocked(scene.graph.registerPendingMove).mockClear();

    act(() =>
      scene.movement().onNodesChange([position("outer", { x: 1510, y: 410 })]),
    );

    expect(scene.graph.registerPendingMove).toHaveBeenCalledWith({
      id: "outer",
      x: 1510,
      y: 410,
    });
    expect(scene.graph.move).not.toHaveBeenCalled();
  });

  it("drops a drag that was cancelled and ignores its late changes", () => {
    const scene = mount();
    const outer = scene.node("outer");
    act(() => scene.movement().onNodeDragStart(mouse(0, 0), outer, [outer]));
    act(() =>
      scene
        .movement()
        .onNodesChange([position("outer", { x: 1510, y: 410 }, true)]),
    );

    act(() => scene.movement().cancel());
    vi.mocked(scene.graph.registerPendingMove).mockClear();
    act(() =>
      scene
        .movement()
        .onNodesChange([position("outer", { x: 1520, y: 420 }, true)]),
    );
    drag(scene, "outer", mouse(1520, 420));

    expect(scene.graph.registerPendingMove).toHaveBeenLastCalledWith(null);
    expect(scene.graph.registerPendingMove).not.toHaveBeenCalledWith(
      expect.objectContaining({ x: 1520 }),
    );
    expect(scene.graph.move).not.toHaveBeenCalled();
    expect(scene.graph.place).not.toHaveBeenCalled();
    expect(scene.node("outer").position).toEqual({ x: 1500, y: 400 });
  });

  it("lets a cancel without a drag leave the next drag untouched", () => {
    const scene = mount();

    act(() => scene.movement().cancel());
    drag(scene, "start", mouse(30, 40));

    expect(scene.graph.move).toHaveBeenCalledWith("start", 0, 0);
  });
});

describe("the frame a dragged card would land in", () => {
  function hover(
    scene: Mounted,
    id: string,
    point: { x: number; y: number },
  ): void {
    // The pointer is given in screen pixels, which the flow shifts to the grid.
    act(() =>
      scene
        .movement()
        .onNodeDrag(mouse(point.x + 1000, point.y + 2000), scene.node(id), []),
    );
  }

  it("marks the group under an agent", () => {
    const scene = mount();

    hover(scene, "outer", { x: 300, y: 350 });

    expect(scene.movement().dropTarget).toBe("group");
  });

  it("marks the loop under an agent, a script or a decision", () => {
    const scene = mount();
    const inLoop = {
      x: planMemberOrigin(LOOP).x + 300,
      y: planMemberOrigin(LOOP).y + 100,
    };

    hover(scene, "outer", inLoop);

    expect(scene.movement().dropTarget).toBe("loop");
  });

  it("marks nothing for an agent outside every frame", () => {
    const scene = mount();
    hover(scene, "outer", { x: 300, y: 350 });

    hover(scene, "outer", { x: 5000, y: 5000 });

    expect(scene.movement().dropTarget).toBeNull();
  });

  it("does not mark a collapsed group", () => {
    const scene = mount({ collapsed: ["group"] });

    hover(scene, "outer", { x: 300, y: 350 });

    expect(scene.movement().dropTarget).toBeNull();
  });

  it("marks only a loop under a group, never another group", () => {
    const scene = mount({
      draft: plan(sessionGroup({ id: "second", x: 3000, y: 0 })),
    });

    hover(scene, "second", {
      x: planMemberOrigin(LOOP).x + 300,
      y: planMemberOrigin(LOOP).y + 100,
    });
    expect(scene.movement().dropTarget).toBe("loop");

    hover(scene, "second", { x: 300, y: 350 });
    expect(scene.movement().dropTarget).toBeNull();
  });

  it("marks the stack under a ticket or a value", () => {
    const scene = mount();

    hover(scene, "task", { x: 2100, y: 100 });
    expect(scene.movement().dropTarget).toBe("stack");

    hover(scene, "value", { x: 5000, y: 5000 });
    expect(scene.movement().dropTarget).toBeNull();

    hover(scene, "value", { x: 2100, y: 100 });
    expect(scene.movement().dropTarget).toBe("stack");
  });

  it("marks nothing for a card that joins no frame", () => {
    const scene = mount();

    hover(scene, "start", { x: 300, y: 350 });

    expect(scene.movement().dropTarget).toBeNull();
  });

  it("reads the pointer of a touch", () => {
    const scene = mount();

    act(() =>
      scene.movement().onNodeDrag(touch(1300, 2350), scene.node("outer"), []),
    );

    expect(scene.movement().dropTarget).toBe("group");
  });

  it("keeps the mark when a touch has no finger left", () => {
    const scene = mount();
    hover(scene, "outer", { x: 300, y: 350 });

    act(() =>
      scene
        .movement()
        .onNodeDrag(
          { changedTouches: [] } as unknown as TouchEvent,
          scene.node("outer"),
          [],
        ),
    );

    expect(scene.movement().dropTarget).toBe("group");
  });

  it("marks nothing for a person who may not edit or after a cancel", () => {
    const readonly = mount({ canEdit: false });
    hover(readonly, "outer", { x: 300, y: 350 });
    expect(readonly.movement().dropTarget).toBeNull();

    const scene = mount();
    act(() =>
      scene.movement().onNodeDragStart(mouse(0, 0), scene.node("outer"), []),
    );
    act(() => scene.movement().cancel());
    hover(scene, "outer", { x: 300, y: 350 });
    expect(scene.movement().dropTarget).toBeNull();
  });

  it("clears the mark when the drag is cancelled", () => {
    const scene = mount();
    hover(scene, "outer", { x: 300, y: 350 });

    act(() => scene.movement().cancel());

    expect(scene.movement().dropTarget).toBeNull();
  });
});

describe("dropping a card", () => {
  it("places an agent at its grid position and the pointer of the flow", () => {
    const scene = mount({ collapsed: ["loop"] });

    drag(scene, "outer", mouse(1300, 2350), { x: 1520, y: 420 });

    expect(scene.graph.place).toHaveBeenCalledWith("outer", {
      position: { x: 1520, y: 420 },
      excludedGroups: new Set(["loop"]),
      pointer: { x: 300, y: 350 },
    });
    expect(scene.graph.move).not.toHaveBeenCalled();
  });

  it("converts the position of a member to the grid before placing it", () => {
    const scene = mount();

    drag(scene, "member", mouse(1300, 2450), { x: 50, y: 150 });

    expect(scene.graph.place).toHaveBeenCalledWith(
      "member",
      expect.objectContaining({ position: { x: 150, y: 350 } }),
    );
  });

  it("counts the position of a group inside a loop from the loop's corner", () => {
    const scene = mount();

    drag(scene, "inner", mouse(1300, 2350), { x: 40, y: 50 });

    expect(scene.graph.placeGroup).toHaveBeenCalledWith(
      "inner",
      expect.objectContaining({ position: { x: 40, y: 1050 } }),
    );
  });

  it("counts the position of an agent of a group inside a loop from that group's corner", () => {
    const scene = mount();
    const origin = planMemberOrigin(LOOP);

    drag(scene, "deep", mouse(1300, 2350), { x: 50, y: 150 });

    expect(scene.graph.place).toHaveBeenCalledWith(
      "deep",
      expect.objectContaining({
        position: { x: origin.x + 15 + 50, y: origin.y + 25 + 150 },
      }),
    );
  });

  it("reads the position of a card whose frame is gone as a grid position", () => {
    const scene = mount();
    const stale = {
      ...scene.node("outer"),
      parentId: "deleted-frame",
      position: { x: 1520, y: 420 },
    };

    act(() =>
      scene.movement().onNodeDragStop(mouse(1300, 2350), stale, [stale]),
    );

    expect(scene.graph.place).toHaveBeenCalledWith(
      "outer",
      expect.objectContaining({ position: { x: 1520, y: 420 } }),
    );
  });

  it("places a whole group", () => {
    const scene = mount();

    drag(scene, "group", mouse(1300, 2350), { x: 100, y: 200 });

    expect(scene.graph.placeGroup).toHaveBeenCalledWith("group", {
      position: { x: 100, y: 200 },
      excludedGroups: new Set(),
      pointer: { x: 300, y: 350 },
    });
  });

  it("joins a stack when a ticket or a value is dropped on it", () => {
    const scene = mount();

    drag(scene, "task", mouse(3100, 2100), { x: 2100, y: 100 });
    drag(scene, "value", mouse(3100, 2100), { x: 2100, y: 100 });

    expect(scene.graph.joinStack).toHaveBeenNthCalledWith(1, "task", "stack");
    expect(scene.graph.joinStack).toHaveBeenNthCalledWith(2, "value", "stack");
    expect(scene.graph.move).not.toHaveBeenCalled();
  });

  it("moves a ticket dropped beside every stack", () => {
    const scene = mount();

    drag(scene, "task", mouse(1900, 2800), { x: 2500, y: 700 });

    expect(scene.graph.move).toHaveBeenCalledWith("task", 2500, 700);
    expect(scene.graph.joinStack).not.toHaveBeenCalled();
  });

  it("moves a card that joins no frame", () => {
    const scene = mount();

    drag(scene, "start", mouse(1300, 2350), { x: 30, y: 40 });

    expect(scene.graph.move).toHaveBeenCalledWith("start", 30, 40);
    expect(scene.graph.place).not.toHaveBeenCalled();
  });

  it("falls back to the card's position when a touch has no finger", () => {
    const scene = mount();

    drag(scene, "outer", { changedTouches: [] } as unknown as TouchEvent);

    expect(scene.graph.place).toHaveBeenCalledWith(
      "outer",
      expect.objectContaining({
        position: { x: 1500, y: 400 },
        pointer: { x: 1500, y: 400 },
      }),
    );
    expect(flow.screenToFlowPosition).not.toHaveBeenCalled();
  });

  it("reads the pointer of a touch", () => {
    const scene = mount();

    drag(scene, "outer", touch(1300, 2350));

    expect(scene.graph.place).toHaveBeenCalledWith(
      "outer",
      expect.objectContaining({ pointer: { x: 300, y: 350 } }),
    );
  });

  it("ends the pending move and the mark of every drop", () => {
    const scene = mount();
    act(() =>
      scene.movement().onNodeDrag(mouse(1300, 2350), scene.node("outer"), []),
    );
    act(() =>
      scene
        .movement()
        .onNodesChange([position("outer", { x: 1510, y: 410 }, true)]),
    );
    expect(scene.movement().dropTarget).toBe("group");

    drag(scene, "outer", mouse(1300, 2350));

    expect(scene.graph.registerPendingMove).toHaveBeenLastCalledWith(null);
    expect(scene.movement().dropTarget).toBeNull();
    expect(scene.node("outer").position).toEqual({ x: 1500, y: 400 });
  });

  it("drops nothing for a person who may not edit", () => {
    const scene = mount({ canEdit: false });

    drag(scene, "outer", mouse(1300, 2350));

    expect(scene.graph.place).not.toHaveBeenCalled();
    expect(scene.graph.move).not.toHaveBeenCalled();
    expect(scene.graph.registerPendingMove).toHaveBeenCalledWith(null);
  });

  it("lets the next drag act after a cancelled one has ended", () => {
    const scene = mount();
    const outer = scene.node("outer");
    act(() => scene.movement().onNodeDragStart(mouse(0, 0), outer, [outer]));
    act(() => scene.movement().cancel());
    drag(scene, "outer", mouse(1300, 2350));
    expect(scene.graph.place).not.toHaveBeenCalled();

    drag(scene, "outer", mouse(1300, 2350));

    expect(scene.graph.place).toHaveBeenCalledTimes(1);
  });
});

describe("a change of permission", () => {
  it("discards an unfinished move", () => {
    const scene = mount();
    act(() =>
      scene
        .movement()
        .onNodesChange([position("outer", { x: 1700, y: 480 }, true)]),
    );
    expect(scene.node("outer").position).toEqual({ x: 1700, y: 480 });

    scene.rerender({ canEdit: false });

    expect(scene.graph.registerPendingMove).toHaveBeenLastCalledWith(null);
    expect(scene.node("outer")).toMatchObject({
      position: { x: 1500, y: 400 },
      draggable: false,
    });
    expect(scene.movement().dropTarget).toBeNull();
  });

  it("clears the pending move when the canvas goes away", () => {
    const scene = mount();

    scene.unmount();

    expect(scene.graph.registerPendingMove).toHaveBeenCalledWith(null);
  });
});
