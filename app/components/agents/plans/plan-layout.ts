import { planNodeParameters } from "@/definition/AgentPlanGroup";
import { planStepTemplate } from "@/definition/AgentPlanConfiguration";

import type {
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanPosition,
  AgentPlanSources,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { PlanLink } from "./plan-links";

export const PLAN_GRID = 20;
export const PLAN_NODE_WIDTH = 280;
export const PLAN_ENDPOINT_SIZE = 64;
/** Space between a frame's edge and its members. */
export const PLAN_FRAME_PADDING = 20;
/** The center of the handles where a frame's boundary ports hand values to members. */
export const PLAN_FRAME_PORT_HANDLE = 296;
const FRAME_MIN_WIDTH = 360;
const FRAME_MIN_MEMBER_AREA = 160;
/** The line below the members that shows the group's `session_id`. */
export const PLAN_FRAME_FOOTER = 32;
// A pointer this close to a frame's edge does not take a node into the frame.
const FRAME_EDGE = 16;

/** End points of a drawn connection in grid coordinates. */
export interface PlanLinkPoints {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/** Where a node is drawn: absolute grid position and size, and the frame around a member. */
export interface PlanNodeBox {
  readonly node: AgentPlanNode;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly group: AgentPlanGroup | null;
}

function agentHeight(step: AgentPlanStep, sources: AgentPlanSources): number {
  return (
    168 + (planStepTemplate(step, sources.agents)?.parameters.length ?? 0) * 32
  );
}

/**
 * The height of a frame's header: name, flow ports and boundary ports.
 *
 * @remarks
 * Its rows follow a node card's geometry, so connections reach a frame's
 * ports exactly as they reach a card's.
 */
export function planGroupHeaderHeight(group: AgentPlanGroup): number {
  return 104 + group.parameters.length * 32;
}

/** A frame grows with its members; an empty frame keeps room to drop the first one. */
export function planGroupWidth(group: AgentPlanGroup): number {
  const right = Math.max(
    0,
    ...group.steps.map((step) => step.x + PLAN_NODE_WIDTH),
  );
  return Math.max(FRAME_MIN_WIDTH, right + 2 * PLAN_FRAME_PADDING);
}

function groupHeight(group: AgentPlanGroup, sources: AgentPlanSources): number {
  const bottom = Math.max(
    0,
    ...group.steps.map((step) => step.y + agentHeight(step, sources)),
  );
  return (
    planGroupHeaderHeight(group) +
    Math.max(FRAME_MIN_MEMBER_AREA, bottom + PLAN_FRAME_PADDING) +
    PLAN_FRAME_FOOTER
  );
}

/** The top left corner of a frame's member area; member positions count from here. */
export function planMemberOrigin(group: AgentPlanGroup): AgentPlanPosition {
  return {
    x: group.x + PLAN_FRAME_PADDING,
    y: group.y + planGroupHeaderHeight(group),
  };
}

/** The absolute grid position of a member. */
export function planMemberPosition(
  group: AgentPlanGroup,
  step: AgentPlanStep,
): AgentPlanPosition {
  const origin = planMemberOrigin(group);
  return { x: origin.x + step.x, y: origin.y + step.y };
}

/** Compact endpoints keep their original coordinates without changing saved plans. */
export function planNodeWidth(node: AgentPlanNode): number {
  if (node.type === "group") return planGroupWidth(node);
  return node.type === "start" || node.type === "end"
    ? PLAN_ENDPOINT_SIZE
    : PLAN_NODE_WIDTH;
}

/** Shared geometry keeps rendered cards and SVG ports aligned. */
export function planNodeHeight(
  node: AgentPlanNode,
  sources: AgentPlanSources,
): number {
  if (node.type === "start" || node.type === "end") return 104;
  if (node.type === "group") return groupHeight(node, sources);
  if (node.type !== "agent") return 140;
  return agentHeight(node, sources);
}

/** Finds where a node is drawn, members of frames included. */
export function planNodeBox(
  plan: AgentPlanInput,
  id: string,
  sources: AgentPlanSources,
): PlanNodeBox | null {
  for (const node of plan.nodes) {
    if (node.id === id)
      return {
        node,
        x: node.x,
        y: node.y,
        width: planNodeWidth(node),
        height: planNodeHeight(node, sources),
        group: null,
      };
    if (node.type !== "group") continue;
    const step = node.steps.find((entry) => entry.id === id);
    if (step)
      return {
        node: step,
        ...planMemberPosition(node, step),
        width: PLAN_NODE_WIDTH,
        height: agentHeight(step, sources),
        group: node,
      };
  }
  return null;
}

/**
 * The frame a dropped node lands in, decided by the pointer alone.
 *
 * @param plan - The plan with its frames.
 * @param point - The pointer in grid coordinates.
 * @param sources - The agents whose templates size the members.
 * @param memberOf - The frame the node belongs to now, if any.
 * @returns The topmost frame under the pointer. A node joins a frame only
 * with the pointer clearly inside it, and a member leaves only once the
 * pointer is outside, so a drop near an edge never flips the membership.
 */
export function planDropGroup(
  plan: AgentPlanInput,
  point: AgentPlanPosition,
  sources: AgentPlanSources,
  memberOf: string | null,
): AgentPlanGroup | null {
  const groups = plan.nodes.filter((node) => node.type === "group");
  for (const group of [...groups].reverse()) {
    const inset = group.id === memberOf ? 0 : FRAME_EDGE;
    const right = group.x + planGroupWidth(group) - inset;
    const bottom = group.y + groupHeight(group, sources) - inset;
    if (
      point.x >= group.x + inset &&
      point.x <= right &&
      point.y >= group.y + inset &&
      point.y <= bottom
    )
      return group;
  }
  return null;
}

/** Labels stay readable when a saved resource has become unavailable. */
export function planNodeLabel(
  node: AgentPlanNode,
  sources: AgentPlanSources,
): string {
  if (node.type === "start" || node.type === "end") return node.type;
  if (
    node.type === "variable" ||
    node.type === "parameter" ||
    node.type === "group"
  )
    return node.name;
  if (node.type === "task") {
    const task = sources.tasks.find((entry) => entry.id === node.taskId);
    return task ? `${task.key}: ${task.title}` : node.taskId;
  }
  return (
    node.configuration?.name ??
    sources.agents.find((entry) => entry.id === node.agentId)?.name ??
    node.agentId
  );
}

/**
 * Neutral cards whose type shows in a thin colored edge besides the type label.
 *
 * @remarks
 * The edge colors stay apart from the status badges in both theme palettes.
 */
export function planNodeClass(type: AgentPlanNode["type"]): string {
  const edges = {
    agent: "border-l-plan-agent",
    group: "border-l-plan-group",
    task: "border-l-plan-ticket",
    variable: "border-l-plan-parameter",
    parameter: "border-l-plan-parameter",
    start: "border-l-muted-foreground/40",
    end: "border-l-muted-foreground/40",
  };
  return `border-border border-l-4 bg-surface ${edges[type]}`;
}

/** Port centers share the card geometry so a line always names the port it actually reaches. */
export function planOutputY(
  node: AgentPlanNode,
  sources: AgentPlanSources,
): number {
  if (node.type === "agent")
    return (
      112 +
      (planStepTemplate(node, sources.agents)?.parameters.length ?? 0) * 32
    );
  return 80;
}

/** The row of a named data input of a card or a frame. */
function inputY(
  box: PlanNodeBox,
  parameter: string,
  sources: AgentPlanSources,
): number {
  const index = planNodeParameters(box.node, sources.agents).findIndex(
    (entry) => entry.name === parameter,
  );
  return box.y + 104 + Math.max(0, index) * 32;
}

/** Where a data connection starts: a node's OUT, or a frame's boundary port towards its members. */
function outputPoint(
  source: PlanNodeBox,
  link: PlanLink,
  sources: AgentPlanSources,
): { readonly x: number; readonly y: number } {
  if (
    link.kind === "data" &&
    link.port !== undefined &&
    source.node.type === "group"
  ) {
    const index = source.node.parameters.findIndex(
      (port) => port.id === link.port,
    );
    return {
      x: source.x + PLAN_FRAME_PORT_HANDLE + 14,
      y: source.y + 104 + Math.max(0, index) * 32,
    };
  }
  return {
    x: source.x + source.width,
    y:
      source.y +
      (link.kind === "flow" ? 72 : planOutputY(source.node, sources)),
  };
}

/** Flow edges join the flow ports; data links join an OUT with its parameter row. */
export function planLinkPoints(
  plan: AgentPlanInput,
  sources: AgentPlanSources,
  link: PlanLink,
): PlanLinkPoints | null {
  const source = planNodeBox(plan, link.from, sources);
  const target = planNodeBox(plan, link.to, sources);
  if (!source || !target) return null;
  const start = outputPoint(source, link, sources);
  return {
    x1: start.x,
    y1: start.y,
    x2: target.x,
    y2:
      link.kind === "flow"
        ? target.y + 72
        : inputY(target, link.parameter, sources),
  };
}
