import { planStepTemplate } from "@/definition/AgentPlanConfiguration";

import type {
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanPosition,
  AgentPlanSources,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";
import type { AgentPlanScript } from "@/definition/AgentPlanScript";
import type { AgentPlanStack } from "@/definition/AgentPlanStack";

/** A container of nodes on the grid: a session group or a loop. */
export type PlanFrame = AgentPlanGroup | AgentPlanLoop;

/** The width of the port rows in a frame's header. */
export const PLAN_NODE_WIDTH = 280;
// Card sizes keep their order: compact start and end, medium value sources,
// agents and scripts widest and as tall as their inputs. The heights count
// the rows of plan-node-card and its 1 px border.
const PLAN_AGENT_WIDTH = 320;
const PLAN_SOURCE_WIDTH = 260;
/** The compact logic node: narrower than an agent, as wide as a value source. */
export const PLAN_DECISION_WIDTH = 260;
const PLAN_ENDPOINT_WIDTH = 160;
const PLAN_ENDPOINT_HEIGHT = 56;
const PLAN_PARAMETER_HEIGHT = 166;
const PLAN_TICKET_HEIGHT = 101;
const PLAN_VARIABLE_HEIGHT = 90;
const AGENT_BASE_HEIGHT = 172;
const AGENT_INPUT_HEIGHT = 38;
// The two optional rows of an agent, Ereignis IN and the boolean Ergebnis, with their gaps.
const AGENT_BRANCHING_HEIGHT = 68;
// Header, condition row with its binding chip, both outputs and the footer line.
const PLAN_DECISION_HEIGHT = 237;
const PLAN_GIT_CLOSEOUT_HEIGHT = 200;
/** The Stack card: wide enough for an entry's key and title beside its number. */
export const PLAN_STACK_WIDTH = 300;
// Header, the In and Out row, the summary, both data outputs and the footer.
const STACK_BASE_HEIGHT = 236;
// One entry of the list with its gap, and the row of an empty list.
const STACK_ENTRY_HEIGHT = 50;
const STACK_EMPTY_HEIGHT = 40;
/** The title row of a loop container. */
export const PLAN_LOOP_TITLE_HEIGHT = 84;
/** One labelled port row of a loop container: In and Out, then the count or while input. */
export const PLAN_LOOP_PORT_ROW = 32;
// A loop container's header: title, its two port rows and the gap before its members.
const LOOP_HEADER_HEIGHT = PLAN_LOOP_TITLE_HEIGHT + 2 * PLAN_LOOP_PORT_ROW + 24;
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
  return (
    AGENT_BASE_HEIGHT +
    96 +
    AGENT_BRANCHING_HEIGHT +
    inputs * AGENT_INPUT_HEIGHT
  );
}

/** A script card has the rows of an agent card: its inputs, its output and its profile. */
function scriptHeight(script: AgentPlanScript): number {
  return AGENT_BASE_HEIGHT + 66 + script.inputs.length * AGENT_INPUT_HEIGHT;
}

/**
 * Space for a frame's header and the gap before its first member row.
 *
 * @param frame - The frame; a loop has two labelled port rows below its title,
 * a group none. Without it the group header is meant.
 */
export function planGroupHeaderHeight(frame?: Pick<PlanFrame, "type">): number {
  return frame?.type === "loop" ? LOOP_HEADER_HEIGHT : 108;
}

/** The height of the Stack card for its entries. */
function stackHeight(stack: AgentPlanStack): number {
  return (
    STACK_BASE_HEIGHT +
    (stack.entries.length === 0
      ? STACK_EMPTY_HEIGHT
      : stack.entries.length * STACK_ENTRY_HEIGHT)
  );
}

function memberHeight(
  member: AgentPlanStep | AgentPlanScript | AgentPlanGroup,
  sources: AgentPlanSources,
): number {
  if (member.type === "group") return groupHeight(member, sources);
  return member.type === "script"
    ? scriptHeight(member)
    : agentHeight(member, sources);
}

function memberWidth(
  member: AgentPlanStep | AgentPlanScript | AgentPlanGroup,
): number {
  return member.type === "group" ? planGroupWidth(member) : PLAN_AGENT_WIDTH;
}

/** A frame grows with its members; an empty frame keeps room to drop the first one. */
export function planGroupWidth(group: PlanFrame): number {
  const right = Math.max(
    0,
    ...group.steps.map((step) => step.x + memberWidth(step)),
  );
  return Math.max(FRAME_MIN_WIDTH, right + 2 * PLAN_FRAME_PADDING);
}

function groupHeight(group: PlanFrame, sources: AgentPlanSources): number {
  const bottom = Math.max(
    0,
    ...group.steps.map((step) => step.y + memberHeight(step, sources)),
  );
  return (
    planGroupHeaderHeight(group) +
    Math.max(FRAME_MIN_MEMBER_AREA, bottom + FRAME_MEMBER_BOTTOM_GAP) +
    PLAN_FRAME_FOOTER
  );
}

/** The top left corner of a frame's member area; member positions count from here. */
export function planMemberOrigin(group: PlanFrame): AgentPlanPosition {
  return {
    x: group.x + PLAN_FRAME_PADDING,
    y: group.y + planGroupHeaderHeight(group),
  };
}

/** The absolute grid position of a member. */
export function planMemberPosition(
  group: PlanFrame,
  step: { readonly x: number; readonly y: number },
): AgentPlanPosition {
  const origin = planMemberOrigin(group);
  return { x: origin.x + step.x, y: origin.y + step.y };
}

/** Cards keep their stored top left corner; only their size follows the card type. */
export function planNodeWidth(node: AgentPlanNode): number {
  if (node.type === "group" || node.type === "loop")
    return planGroupWidth(node);
  if (
    node.type === "agent" ||
    node.type === "script" ||
    node.type === "git_closeout"
  )
    return PLAN_AGENT_WIDTH;
  if (node.type === "decision") return PLAN_DECISION_WIDTH;
  if (node.type === "stack") return PLAN_STACK_WIDTH;
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
    decision: PLAN_DECISION_HEIGHT,
    task: PLAN_TICKET_HEIGHT,
    variable: PLAN_VARIABLE_HEIGHT,
  };
  if (node.type === "group" || node.type === "loop")
    return groupHeight(node, sources);
  if (node.type === "agent") return agentHeight(node, sources);
  if (node.type === "script") return scriptHeight(node);
  if (node.type === "git_closeout") return PLAN_GIT_CLOSEOUT_HEIGHT;
  if (node.type === "stack") return stackHeight(node);
  return heights[node.type];
}

/**
 * The stack a dropped ticket or value node lands in, decided by the pointer alone.
 *
 * @returns The topmost stack card under the pointer, or `null`.
 */
export function planDropStack(
  plan: AgentPlanInput,
  point: AgentPlanPosition,
): AgentPlanStack | null {
  const stacks = plan.nodes.filter((node) => node.type === "stack");
  for (const stack of [...stacks].reverse())
    if (
      point.x >= stack.x &&
      point.x <= stack.x + PLAN_STACK_WIDTH &&
      point.y >= stack.y &&
      point.y <= stack.y + stackHeight(stack)
    )
      return stack;
  return null;
}

/**
 * The frame a dropped node lands in, decided by the pointer alone.
 *
 * @param plan - The plan with its frames.
 * @param point - The pointer in grid coordinates.
 * @param sources - The agents whose templates size the members.
 * @param memberOf - The frame the node belongs to now, if any.
 * @returns The topmost frame, a group or a loop, under the pointer. A node
 * joins a frame only with the pointer clearly inside it, and a member leaves
 * only once the pointer is outside, so a drop near an edge never flips the
 * membership.
 */
export function planDropGroup(
  plan: AgentPlanInput,
  point: AgentPlanPosition,
  sources: AgentPlanSources,
  memberOf: string | null,
): PlanFrame | null {
  const groups = plan.nodes.filter(
    (node) => node.type === "group" || node.type === "loop",
  );
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
  if (node.type === "decision") return node.name ?? node.type;
  if (node.type === "task") {
    const task = sources.tasks.find((entry) => entry.id === node.taskId);
    return task ? `${task.key}: ${task.title}` : node.taskId;
  }
  if (node.type !== "agent") return node.name;
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
  git_closeout: "border-plan-script/60 bg-plan-script-subtle",
  group: "border-plan-group/60 bg-plan-group-subtle",
  loop: "border-plan-loop-edge/60 bg-plan-loop-subtle",
  decision: "border-plan-logic-edge/60 bg-plan-logic-subtle",
  stack: "border-plan-stack-edge/60 bg-plan-stack-subtle",
  task: "border-plan-ticket-edge bg-plan-ticket-subtle",
  variable: "border-plan-parameter/60 bg-plan-parameter-subtle",
  parameter: "border-plan-parameter/60 bg-plan-parameter-subtle",
};

const NODE_ACCENTS = {
  start: "text-plan-checkpoint",
  end: "text-plan-checkpoint",
  agent: "text-plan-agent",
  script: "text-plan-script",
  git_closeout: "text-plan-script",
  group: "text-plan-group",
  loop: "text-plan-loop",
  decision: "text-plan-logic",
  stack: "text-plan-stack",
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
