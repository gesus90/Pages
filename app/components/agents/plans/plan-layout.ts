import { planStepTemplate } from "@/definition/AgentPlanConfiguration";

import type {
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanPosition,
  AgentPlanSources,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";

export const PLAN_GRID = 20;
export const PLAN_NODE_WIDTH = 280;
const PLAN_ENDPOINT_SIZE = 64;
/** Space between a frame's edge and its members. */
export const PLAN_FRAME_PADDING = 20;
const FRAME_MIN_WIDTH = 360;
const FRAME_MIN_MEMBER_AREA = 160;
/** The line below the members that shows the group's `session_id`. */
export const PLAN_FRAME_FOOTER = 32;
// A pointer this close to a frame's edge does not take a node into the frame.
const FRAME_EDGE = 16;

function agentHeight(step: AgentPlanStep, sources: AgentPlanSources): number {
  return (
    152 + (planStepTemplate(step, sources.agents)?.parameters.length ?? 0) * 32
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

/** Bounds size React Flow nodes and keep group membership hit areas consistent. */
export function planNodeHeight(
  node: AgentPlanNode,
  sources: AgentPlanSources,
): number {
  if (node.type === "start" || node.type === "end") return 104;
  if (node.type === "group") return groupHeight(node, sources);
  if (node.type !== "agent") return 128;
  return agentHeight(node, sources);
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
