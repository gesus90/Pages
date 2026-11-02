import { expect, it } from "vitest";

import {
  PLAN_FRAME_PADDING,
  planAgentName,
  planDropGroup,
  planGroupHeaderHeight,
  planGroupWidth,
  planMemberOrigin,
  planMemberPosition,
  planNodeAccent,
  planNodeClass,
  planNodeHeight,
  planNodeLabel,
  planNodeWidth,
} from "@/app/components/agents/plans/plan-layout";
import { emptyPlanLoop } from "@/definition/AgentPlanLoop";

import {
  GROUP_SOURCES,
  agentNode,
  ownCopy,
  planOf,
  scriptNode,
  sessionGroup,
} from "./plan-group-fixture";

import type { AgentPlanNode } from "@/definition/AgentPlan";

const START: AgentPlanNode = { id: "start", type: "start", x: 0, y: 0 };
const END: AgentPlanNode = { id: "end", type: "end", x: 0, y: 0 };
const TICKET: AgentPlanNode = {
  id: "ticket",
  type: "task",
  x: 0,
  y: 0,
  taskId: "task-1",
};
const LOST_TICKET: AgentPlanNode = { ...TICKET, taskId: "gone" };
const VARIABLE: AgentPlanNode = {
  id: "variable",
  type: "variable",
  x: 0,
  y: 0,
  name: "Variable",
};
const DECISION: AgentPlanNode = {
  id: "decision",
  type: "decision",
  x: 0,
  y: 0,
};
const PARAMETER: AgentPlanNode = {
  id: "parameter",
  type: "parameter",
  x: 0,
  y: 0,
  name: "Limit",
  format: "number",
  value: { type: "number", number: 3 },
};

it("sizes cards by type: compact endpoints, medium sources, agents and scripts by their inputs", () => {
  expect(planNodeWidth(START)).toBe(160);
  expect(planNodeWidth(END)).toBe(160);
  expect(planNodeWidth(TICKET)).toBe(260);
  expect(planNodeWidth(PARAMETER)).toBe(260);
  // The logic card is as compact as a value source and narrower than an agent.
  expect(planNodeWidth(DECISION)).toBe(260);
  expect(planNodeWidth(agentNode("a", "codex"))).toBe(320);
  expect(planNodeWidth(scriptNode("s", 0))).toBe(320);
  expect(planNodeHeight(START, GROUP_SOURCES)).toBe(56);
  expect(planNodeHeight(END, GROUP_SOURCES)).toBe(56);
  expect(planNodeHeight(PARAMETER, GROUP_SOURCES)).toBe(166);
  expect(planNodeHeight(TICKET, GROUP_SOURCES)).toBe(101);
  expect(planNodeHeight(VARIABLE, GROUP_SOURCES)).toBe(90);
  expect(planNodeHeight(DECISION, GROUP_SOURCES)).toBe(237);
  // An agent grows by one row per input of its template; an unknown agent has none.
  // Its event input and boolean result add 68 to every agent.
  expect(planNodeHeight(agentNode("a", "codex"), GROUP_SOURCES)).toBe(374);
  expect(planNodeHeight(agentNode("a", "codex-two"), GROUP_SOURCES)).toBe(412);
  expect(planNodeHeight(agentNode("a", "missing"), GROUP_SOURCES)).toBe(336);
  expect(
    planNodeHeight(
      agentNode("a", "missing", { configuration: ownCopy("Copy", 3) }),
      GROUP_SOURCES,
    ),
  ).toBe(450);
  expect(planNodeHeight(scriptNode("s", 2), GROUP_SOURCES)).toBe(314);
});

it("keeps an empty frame large enough to drop a first member into", () => {
  const group = sessionGroup({ x: 100, y: 100 });
  expect(planGroupHeaderHeight()).toBe(108);
  expect(planGroupWidth(group)).toBe(680);
  expect(planNodeWidth(group)).toBe(680);
  expect(planNodeHeight(group, GROUP_SOURCES)).toBe(108 + 160 + 32);
  const loop = emptyPlanLoop("loop", "Loop", { x: 0, y: 0 });
  expect(planNodeWidth(loop)).toBe(680);
  expect(planNodeHeight(loop, GROUP_SOURCES)).toBe(300);
});

it("grows a frame with its farthest agent and script members", () => {
  const group = sessionGroup({
    steps: [agentNode("far", "codex", { x: 500, y: 20 })],
  });
  expect(planGroupWidth(group)).toBe(500 + 320 + 2 * PLAN_FRAME_PADDING);
  expect(planNodeHeight(group, GROUP_SOURCES)).toBe(108 + 20 + 374 + 32 + 32);
  const loop = {
    ...emptyPlanLoop("loop", "Loop", { x: 0, y: 0 }),
    steps: [scriptNode("script", 1, {}), agentNode("member", "claude")],
  };
  // The agent without inputs (336) is taller than the script with one input (276).
  expect(planNodeHeight(loop, GROUP_SOURCES)).toBe(108 + 336 + 32 + 32);
});

it("places members relative to the member area below the frame header", () => {
  const group = sessionGroup({ x: 40, y: 60 });
  expect(planMemberOrigin(group)).toEqual({ x: 60, y: 168 });
  expect(
    planMemberPosition(group, agentNode("member", "codex", { x: 20, y: 40 })),
  ).toEqual({ x: 80, y: 208 });
  expect(planMemberPosition(group, scriptNode("script", 0))).toEqual({
    x: 60,
    y: 168,
  });
});

it("takes a dropped node only into a frame the pointer is clearly inside", () => {
  const group = sessionGroup({ id: "outer", x: 100, y: 100 });
  const plan = planOf([START, group, TICKET]);
  expect(planDropGroup(plan, { x: 300, y: 200 }, GROUP_SOURCES, null)?.id).toBe(
    "outer",
  );
  // Near the edge a node outside stays outside ...
  for (const point of [
    { x: 110, y: 200 },
    { x: 775, y: 200 },
    { x: 300, y: 110 },
    { x: 300, y: 395 },
  ])
    expect(planDropGroup(plan, point, GROUP_SOURCES, null)).toBeNull();
  // ... and a member stays a member until the pointer leaves the frame.
  expect(
    planDropGroup(plan, { x: 110, y: 395 }, GROUP_SOURCES, "outer")?.id,
  ).toBe("outer");
  expect(
    planDropGroup(plan, { x: 99, y: 200 }, GROUP_SOURCES, "outer"),
  ).toBeNull();
});

it("picks the topmost of overlapping frames, groups and loops alike", () => {
  const group = sessionGroup({ id: "under", x: 0, y: 0 });
  const loop = emptyPlanLoop("over", "Loop", { x: 200, y: 100 });
  const plan = planOf([group, loop]);
  expect(planDropGroup(plan, { x: 300, y: 200 }, GROUP_SOURCES, null)?.id).toBe(
    "over",
  );
  expect(planDropGroup(plan, { x: 100, y: 50 }, GROUP_SOURCES, null)?.id).toBe(
    "under",
  );
  expect(
    planDropGroup(planOf([START]), { x: 0, y: 0 }, GROUP_SOURCES, null),
  ).toBeNull();
});

it("names an agent by its own copy, else its agent, else not at all", () => {
  expect(
    planAgentName(
      agentNode("a", "codex", { configuration: ownCopy("Pinned", 0) }),
      GROUP_SOURCES,
    ),
  ).toBe("Pinned");
  expect(planAgentName(agentNode("a", "codex"), GROUP_SOURCES)).toBe(
    "Codex One",
  );
  expect(planAgentName(agentNode("a", "missing"), GROUP_SOURCES)).toBe("");
});

it("labels every node type and keeps unavailable resources readable", () => {
  const labels = [
    START,
    END,
    VARIABLE,
    PARAMETER,
    sessionGroup(),
    emptyPlanLoop("loop", "Loop name", { x: 0, y: 0 }),
    DECISION,
    { ...DECISION, name: "Prüfen & bewerten" },
    scriptNode("s", 0),
    TICKET,
    LOST_TICKET,
    agentNode("a", "codex", { configuration: ownCopy("Pinned", 0) }),
    agentNode("b", "codex"),
    agentNode("c", "missing-agent"),
  ].map((node) => planNodeLabel(node, GROUP_SOURCES));
  expect(labels).toEqual([
    "start",
    "end",
    "Variable",
    "Limit",
    "Session",
    "Loop name",
    "decision",
    "Prüfen & bewerten",
    "Script s",
    "SYN-1: Open work",
    "gone",
    "Pinned",
    "Codex One",
    "missing-agent",
  ]);
});

it("gives each node type its own tint and accent", () => {
  const types = [
    "start",
    "end",
    "agent",
    "script",
    "group",
    "loop",
    "decision",
    "task",
    "variable",
    "parameter",
  ] as const;
  expect(types.map(planNodeClass)).toEqual([
    "border-plan-checkpoint/60 bg-plan-checkpoint-subtle",
    "border-plan-checkpoint/60 bg-plan-checkpoint-subtle",
    "border-plan-agent/60 bg-plan-agent-subtle",
    "border-plan-script/60 bg-plan-script-subtle",
    "border-plan-group/60 bg-plan-group-subtle",
    "border-plan-loop-edge/60 bg-plan-loop-subtle",
    "border-plan-logic-edge/60 bg-plan-logic-subtle",
    "border-plan-ticket-edge bg-plan-ticket-subtle",
    "border-plan-parameter/60 bg-plan-parameter-subtle",
    "border-plan-parameter/60 bg-plan-parameter-subtle",
  ]);
  expect(types.map(planNodeAccent)).toEqual([
    "text-plan-checkpoint",
    "text-plan-checkpoint",
    "text-plan-agent",
    "text-plan-script",
    "text-plan-group",
    "text-plan-loop",
    "text-plan-logic",
    "text-plan-ticket",
    "text-plan-parameter",
    "text-plan-parameter",
  ]);
});
