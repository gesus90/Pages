import { MarkerType } from "@xyflow/react";
import { expect, it } from "vitest";

import {
  planFlowConnection,
  planFlowEdges,
  planFlowNodes,
  planFlowSource,
} from "@/app/components/agents/plans/plan-flow-model";
import {
  PLAN_FRAME_PADDING,
  PLAN_GROUP_COMPACT_HEIGHT,
  PLAN_GROUP_COMPACT_WIDTH,
  planGroupHeaderHeight,
  planNodeWidth,
} from "@/app/components/agents/plans/plan-layout";

import {
  agentStep,
  EMPTY_SOURCES,
  flow,
  groupNode,
  loopNode,
  planOf,
  scriptStep,
} from "./plan-flow-fixture";

import type { AgentPlanInput } from "@/definition/AgentPlan";

const START = { id: "start", type: "start", x: 0, y: 0 } as const;
const END = { id: "end", type: "end", x: 900, y: 0 } as const;
const TICKET = {
  id: "ticket",
  type: "task",
  x: 0,
  y: 300,
  taskId: "1",
} as const;
const VARIABLE = {
  id: "variable",
  type: "variable",
  x: 0,
  y: 400,
  name: "v",
} as const;
const PARAMETER = {
  id: "parameter",
  type: "parameter",
  x: 0,
  y: 500,
  name: "p",
  format: "string",
  value: { type: "text", text: "kept" },
} as const;

/** Start → writer → group(a → b) → loop(script) → end; writer reads the ticket. */
function framedPlan(): AgentPlanInput {
  return planOf(
    [
      START,
      {
        ...agentStep("writer", {
          ticket: { kind: "source", nodeId: "ticket" },
        }),
        x: 300,
      },
      groupNode(
        "group",
        [agentStep("a"), { ...agentStep("b"), x: 40, y: 60 }],
        {
          edges: [flow("a", "b")],
        },
      ),
      loopNode(
        "loop",
        [scriptStep("script", 1), scriptStep("silent", 0)],
        [flow("script", "silent")],
      ),
      END,
      TICKET,
    ],
    [
      flow("start", "writer"),
      flow("writer", "a"),
      flow("b", "script"),
      flow("loop", "end"),
    ],
  );
}

it("projects every node and member with its layer, size and drag rules", () => {
  const nodes = planFlowNodes(framedPlan(), {
    sources: EMPTY_SOURCES,
    selectedId: "writer",
    canEdit: true,
  });

  expect(nodes.map((node) => [node.id, node.parentId])).toEqual([
    ["start", undefined],
    ["writer", undefined],
    ["group", undefined],
    ["a", "group"],
    ["b", "group"],
    ["loop", undefined],
    ["script", "loop"],
    ["silent", "loop"],
    ["end", undefined],
    ["ticket", undefined],
  ]);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  expect(byId.get("writer")).toMatchObject({
    type: "plan",
    position: { x: 300, y: 0 },
    selected: true,
    draggable: true,
    deletable: false,
    dragHandle: "[data-plan-handle]",
    zIndex: 3,
    style: { width: planNodeWidth(agentStep("writer")) },
  });
  expect(byId.get("start")?.style).toEqual({
    minWidth: byId.get("start")?.initialWidth,
    minHeight: byId.get("start")?.initialHeight,
  });
  expect(byId.get("group")).toMatchObject({ zIndex: 0, selected: false });
  expect(byId.get("group")?.style).toEqual({
    width: byId.get("group")?.initialWidth,
    height: byId.get("group")?.initialHeight,
  });
  expect(byId.get("b")).toMatchObject({
    hidden: false,
    position: { x: 40 + PLAN_FRAME_PADDING, y: 60 + planGroupHeaderHeight() },
  });
  expect(byId.get("script")?.hidden).toBe(false);
});

it("shrinks a collapsed group and hides its members from a read-only canvas", () => {
  const nodes = planFlowNodes(framedPlan(), {
    sources: EMPTY_SOURCES,
    selectedId: null,
    canEdit: false,
    collapsedGroups: new Set(["group"]),
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));

  expect(byId.get("group")).toMatchObject({
    initialWidth: PLAN_GROUP_COMPACT_WIDTH,
    initialHeight: PLAN_GROUP_COMPACT_HEIGHT,
    draggable: false,
  });
  expect(byId.get("a")?.hidden).toBe(true);
  expect(byId.get("script")?.hidden).toBe(false);
});

it("draws flow, data and loop boundary connections with their handles", () => {
  const plan = framedPlan();
  const edges = planFlowEdges(plan, EMPTY_SOURCES, {
    kind: "flow",
    from: "start",
    to: "writer",
  });

  expect(
    edges.map((edge) => [
      edge.id,
      edge.source,
      edge.sourceHandle,
      edge.target,
      edge.targetHandle,
    ]),
  ).toEqual([
    ["loop-in:loop:script", "loop", "inner-in", "script", "flow-in"],
    ["loop-out:loop:silent", "silent", "flow-out", "loop", "inner-out"],
    ["flow:start:writer", "start", "flow-out", "writer", "flow-in"],
    ["flow:writer:a", "writer", "flow-out", "a", "flow-in"],
    ["flow:b:script", "b", "flow-out", "script", "flow-in"],
    ["flow:loop:end", "loop", "flow-out", "end", "flow-in"],
    ["data:writer:ticket", "ticket", "value-out", "writer", "input:ticket"],
    ["flow:a:b", "a", "flow-out", "b", "flow-in"],
    ["flow:script:silent", "script", "flow-out", "silent", "flow-in"],
  ]);
  const [entry, , first] = edges;
  expect(entry).toMatchObject({
    selectable: false,
    focusable: false,
    data: {
      link: { kind: "flow", from: "loop", to: "script" },
      name: "",
      isBoundary: true,
    },
    markerEnd: { type: MarkerType.ArrowClosed },
  });
  expect(first).toMatchObject({ selected: true, deletable: false, zIndex: 1 });
  expect(first?.data?.name).toBe(first?.ariaLabel);
  expect(edges.filter((edge) => edge.selected)).toHaveLength(1);
});

it("leaves out connections that end at a legacy group frame or its boundary port", () => {
  const port = {
    id: "port",
    name: "topic",
    type: "text",
    description: "",
    isRequired: false,
    defaultValue: null,
  } as const;
  const member = agentStep("a", { topic: { kind: "source", nodeId: "port" } });
  const plan = planOf(
    [START, groupNode("group", [member], { parameters: [port] }), END],
    [flow("start", "group"), flow("group", "end"), flow("start", "end")],
  );

  expect(
    planFlowEdges(plan, EMPTY_SOURCES, null).map((edge) => edge.id),
  ).toEqual(["flow:start:end"]);
});

it("routes connections of a collapsed group's members to the frame and hides inner ones", () => {
  const edges = planFlowEdges(
    framedPlan(),
    EMPTY_SOURCES,
    null,
    new Set(["group"]),
  );
  const byId = new Map(edges.map((edge) => [edge.id, edge]));

  expect(byId.has("flow:a:b")).toBe(false);
  expect(byId.get("flow:writer:a")).toMatchObject({
    source: "writer",
    sourceHandle: "flow-out",
    target: "group",
    targetHandle: "route:flow:writer:a:to",
    data: { routeEnd: "to" },
  });
  expect(byId.get("flow:b:script")).toMatchObject({
    source: "group",
    sourceHandle: "route:flow:b:script:from",
    target: "script",
    targetHandle: "flow-in",
    data: { routeEnd: "from" },
  });
});

it("finds the source behind a visible OUT, members included", () => {
  const plan = planOf([
    groupNode("group", [agentStep("a")]),
    loopNode("loop", [scriptStep("script", 1), scriptStep("silent", 0)]),
    START,
    END,
    TICKET,
    VARIABLE,
    PARAMETER,
  ]);

  expect(planFlowSource(plan, "start", "flow-out")).toEqual({
    kind: "flow",
    nodeId: "start",
  });
  expect(planFlowSource(plan, "a", "flow-out")).toEqual({
    kind: "flow",
    nodeId: "a",
  });
  expect(planFlowSource(plan, "a", "value-out")).toEqual({
    kind: "result",
    nodeId: "a",
  });
  expect(planFlowSource(plan, "script", "value-out")).toEqual({
    kind: "result",
    nodeId: "script",
  });
  for (const id of ["ticket", "variable", "parameter"])
    expect(planFlowSource(plan, id, "value-out")).toEqual({
      kind: "source",
      nodeId: id,
    });
});

it("refuses an OUT that does not exist on the node", () => {
  const plan = planOf([
    loopNode("loop", [scriptStep("silent", 0)]),
    START,
    END,
    TICKET,
  ]);

  expect(planFlowSource(plan, "missing", "flow-out")).toBeNull();
  expect(planFlowSource(plan, "end", "flow-out")).toBeNull();
  expect(planFlowSource(plan, "ticket", "flow-out")).toBeNull();
  expect(planFlowSource(plan, "silent", "value-out")).toBeNull();
  expect(planFlowSource(plan, "start", "value-out")).toBeNull();
  expect(planFlowSource(plan, "start", null)).toBeNull();
});

it("turns a complete library connection into a flow or an input binding", () => {
  const plan = planOf([START, agentStep("writer"), TICKET]);

  expect(
    planFlowConnection(plan, {
      source: "start",
      sourceHandle: "flow-out",
      target: "writer",
      targetHandle: "flow-in",
    }),
  ).toEqual({ source: { kind: "flow", nodeId: "start" }, targetId: "writer" });
  expect(
    planFlowConnection(plan, {
      source: "ticket",
      sourceHandle: "value-out",
      target: "writer",
      targetHandle: "input:ticket",
    }),
  ).toEqual({
    source: { kind: "source", nodeId: "ticket" },
    targetId: "writer",
    parameter: "ticket",
  });
});

it("ignores a library connection with an unknown handle", () => {
  const plan = planOf([START, agentStep("writer")]);

  expect(
    planFlowConnection(plan, {
      source: "writer",
      sourceHandle: "inner-in",
      target: "start",
      targetHandle: "flow-in",
    }),
  ).toBeNull();
  for (const targetHandle of [null, "inner-out"])
    expect(
      planFlowConnection(plan, {
        source: "start",
        sourceHandle: "flow-out",
        target: "writer",
        targetHandle,
      }),
    ).toBeNull();
});
