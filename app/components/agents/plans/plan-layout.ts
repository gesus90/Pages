import { planStepTemplate } from "@/definition/AgentPlanConfiguration";

import type {
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanPosition,
  AgentPlanSources,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { AgentPlanScript } from "@/definition/AgentPlanScript";

export const PLAN_GRID = 20;
/** The width of the port rows in a frame's header. */
export const PLAN_NODE_WIDTH = 280;
// Card sizes keep their order: compact start and end, medium value sources,
// agents and scripts widest and as tall as their inputs. The heights count
// the rows of plan-node-card and its 1 px border.
const PLAN_AGENT_WIDTH = 320;
const PLAN_SOURCE_WIDTH = 260;
const PLAN_ENDPOINT_WIDTH = 160;
const PLAN_ENDPOINT_HEIGHT = 56;
const PLAN_PARAMETER_HEIGHT = 166;
const PLAN_TICKET_HEIGHT = 101;
const PLAN_VARIABLE_HEIGHT = 90;
const AGENT_BASE_HEIGHT = 172;
const AGENT_INPUT_HEIGHT = 38;
/** Space between a frame's edge and its members. */
export const PLAN_FRAME_PADDING = 20;
const FRAME_MIN_WIDTH = 680;
export const PLAN_GROUP_COMPACT_WIDTH = 310;
export const PLAN_GROUP_COMPACT_HEIGHT = 115;
const FRAME_MIN_MEMBER_AREA = 160;
const FRAME_MEMBER_BOTTOM_GAP = 32;
/** The line below the members that shows the group's `session_id`. */
export const PLAN_FRAME_FOOTER = 32;
// A pointer this close to a frame's edge does not take a node into the frame.
const FRAME_EDGE = 16;

function agentHeight(step: AgentPlanStep, sources: AgentPlanSources): number {
  const inputs = planStepTemplate(step, sources.agents)?.parameters.length ?? 0;
  return AGENT_BASE_HEIGHT + inputs * AGENT_INPUT_HEIGHT;
}

/** A script card has the rows of an agent card: its inputs, its output and its profile. */
function scriptHeight(script: AgentPlanScript): number {
  return AGENT_BASE_HEIGHT + script.inputs.length * AGENT_INPUT_HEIGHT;
}

/**
 * Space for the portless frame header and the gap before its first member row.
 */
export function planGroupHeaderHeight(): number {
  return 108;
}

/** A frame grows with its members; an empty frame keeps room to drop the first one. */
export function planGroupWidth(group: AgentPlanGroup): number {
  const right = Math.max(
    0,
    ...group.steps.map((step) => step.x + PLAN_AGENT_WIDTH),
  );
  return Math.max(FRAME_MIN_WIDTH, right + 2 * PLAN_FRAME_PADDING);
}

function groupHeight(group: AgentPlanGroup, sources: AgentPlanSources): number {
  const bottom = Math.max(
    0,
    ...group.steps.map((step) => step.y + agentHeight(step, sources)),
  );
  return (
    planGroupHeaderHeight() +
    Math.max(FRAME_MIN_MEMBER_AREA, bottom + FRAME_MEMBER_BOTTOM_GAP) +
    PLAN_FRAME_FOOTER
  );
}

/** The top left corner of a frame's member area; member positions count from here. */
export function planMemberOrigin(group: AgentPlanGroup): AgentPlanPosition {
  return {
    x: group.x + PLAN_FRAME_PADDING,
    y: group.y + planGroupHeaderHeight(),
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

/** Cards keep their stored top left corner; only their size follows the card type. */
export function planNodeWidth(node: AgentPlanNode): number {
  if (node.type === "group") return planGroupWidth(node);
  if (node.type === "agent" || node.type === "script") return PLAN_AGENT_WIDTH;
  return node.type === "start" || node.type === "end"
    ? PLAN_ENDPOINT_WIDTH
    : PLAN_SOURCE_WIDTH;
}

/**
 * Bounds size React Flow nodes and keep group membership hit areas consistent.
 *
 * @remarks
 * A card is at least this tall; larger text lets it grow, and React Flow
 * then measures its ports again.
 */
export function planNodeHeight(
  node: AgentPlanNode,
  sources: AgentPlanSources,
): number {
  const heights = {
    start: PLAN_ENDPOINT_HEIGHT,
    end: PLAN_ENDPOINT_HEIGHT,
    parameter: PLAN_PARAMETER_HEIGHT,
    task: PLAN_TICKET_HEIGHT,
    variable: PLAN_VARIABLE_HEIGHT,
  };
  if (node.type === "group") return groupHeight(node, sources);
  if (node.type === "agent") return agentHeight(node, sources);
  if (node.type === "script") return scriptHeight(node);
  return heights[node.type];
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

/**
 * The name of an agent node: its own copy first, else its agent.
 *
 * @returns An empty text when neither is known; callers name the missing
 * agent instead of showing its identifier.
 */
export function planAgentName(
  step: AgentPlanStep,
  sources: AgentPlanSources,
): string {
  return (
    step.configuration?.name ??
    sources.agents.find((entry) => entry.id === step.agentId)?.name ??
    ""
  );
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
    node.type === "group" ||
    node.type === "script"
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

const NODE_TINTS = {
  start: "border-plan-checkpoint/60 bg-plan-checkpoint-subtle",
  end: "border-plan-checkpoint/60 bg-plan-checkpoint-subtle",
  agent: "border-plan-agent/60 bg-plan-agent-subtle",
  script: "border-plan-script/60 bg-plan-script-subtle",
  group: "border-plan-group/60 bg-plan-group-subtle",
  task: "border-plan-ticket-edge bg-plan-ticket-subtle",
  variable: "border-plan-parameter/60 bg-plan-parameter-subtle",
  parameter: "border-plan-parameter/60 bg-plan-parameter-subtle",
};

const NODE_ACCENTS = {
  start: "text-plan-checkpoint",
  end: "text-plan-checkpoint",
  agent: "text-plan-agent",
  script: "text-plan-script",
  group: "text-plan-group",
  task: "text-plan-ticket",
  variable: "text-plan-parameter",
  parameter: "text-plan-parameter",
};

/**
 * A calm tint and border in the color of the node type.
 *
 * @remarks
 * The type colors stay apart from the run status colors in both theme
 * palettes; a card shows its status colors instead only while a run of the
 * same revision is shown.
 */
export function planNodeClass(type: AgentPlanNode["type"]): string {
  return NODE_TINTS[type];
}

/** The type color of a card's icon. */
export function planNodeAccent(type: AgentPlanNode["type"]): string {
  return NODE_ACCENTS[type];
}
