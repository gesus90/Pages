import { planStepTemplate } from "./AgentPlanConfiguration";
import { planDecisionMode, planDecisionOutputPorts } from "./AgentPlanDecision";

import type {
  AgentPlanDecision,
  AgentPlanNode,
  AgentPlanPosition,
  AgentPlanSources,
  AgentPlanStep,
} from "./AgentPlan";
import type { AgentPlanGroup } from "./AgentPlanGroup";
import type { AgentPlanLoop } from "./AgentPlanLoop";
import type { AgentPlanScript } from "./AgentPlanScript";
import type { AgentPlanStack } from "./AgentPlanStack";

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
// Header, preview, file name, meta line and the data OUT of an asset card.
const PLAN_ASSET_HEIGHT = 268;
const AGENT_BASE_HEIGHT = 172;
const AGENT_INPUT_HEIGHT = 38;
// The two optional rows of an agent, Ereignis IN and the boolean Ergebnis, with their gaps.
const AGENT_BRANCHING_HEIGHT = 68;
// Header, sequence row, data row with its binding chip, two outputs and the footer line.
const PLAN_DECISION_HEIGHT = 269;
// One more output of a classification, and the question and model rows of a model decision.
const DECISION_OUTPUT_HEIGHT = 36;
const DECISION_MODEL_HEIGHT = 64;
const PLAN_GIT_CLOSEOUT_HEIGHT = 200;
/** The Stack card: wide enough for an entry's key and title beside its number. */
export const PLAN_STACK_WIDTH = 300;
// Header, the In and Out row, the summary, the file drop row, both data
// outputs and the footer.
const STACK_BASE_HEIGHT = 278;
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

/**
 * The height of the Stack card for its entries.
 *
 * @param stack - The stack whose entries are listed on its card.
 */
export function planStackHeight(stack: AgentPlanStack): number {
  return (
    STACK_BASE_HEIGHT +
    (stack.entries.length === 0
      ? STACK_EMPTY_HEIGHT
      : stack.entries.length * STACK_ENTRY_HEIGHT)
  );
}

/** A decision grows with its outputs and, as a model decision, with its question and model. */
function decisionHeight(decision: AgentPlanDecision): number {
  const outputs = Math.max(1, planDecisionOutputPorts(decision).length);
  return (
    PLAN_DECISION_HEIGHT +
    Math.max(0, outputs - 2) * DECISION_OUTPUT_HEIGHT +
    (planDecisionMode(decision) === "model" ? DECISION_MODEL_HEIGHT : 0)
  );
}

/** What a frame shows: its members and its decisions (PAGE-286). */
type FrameContent =
  AgentPlanStep | AgentPlanScript | AgentPlanGroup | AgentPlanDecision;

function frameContent(group: PlanFrame): readonly FrameContent[] {
  return [...group.steps, ...(group.decisions ?? [])];
}

function memberHeight(member: FrameContent, sources: AgentPlanSources): number {
  if (member.type === "group") return groupHeight(member, sources);
  if (member.type === "decision") return decisionHeight(member);
  return member.type === "script"
    ? scriptHeight(member)
    : agentHeight(member, sources);
}

function memberWidth(member: FrameContent): number {
  if (member.type === "decision") return PLAN_DECISION_WIDTH;
  return member.type === "group" ? planGroupWidth(member) : PLAN_AGENT_WIDTH;
}

/** A frame grows with its members; an empty frame keeps room to drop the first one. */
export function planGroupWidth(group: PlanFrame): number {
  const right = Math.max(
    0,
    ...frameContent(group).map((step) => step.x + memberWidth(step)),
  );
  return Math.max(FRAME_MIN_WIDTH, right + 2 * PLAN_FRAME_PADDING);
}

function groupHeight(group: PlanFrame, sources: AgentPlanSources): number {
  const bottom = Math.max(
    0,
    ...frameContent(group).map((step) => step.y + memberHeight(step, sources)),
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
    task: PLAN_TICKET_HEIGHT,
    variable: PLAN_VARIABLE_HEIGHT,
    asset: PLAN_ASSET_HEIGHT,
  };
  if (node.type === "group" || node.type === "loop")
    return groupHeight(node, sources);
  if (node.type === "agent") return agentHeight(node, sources);
  if (node.type === "script") return scriptHeight(node);
  if (node.type === "git_closeout") return PLAN_GIT_CLOSEOUT_HEIGHT;
  if (node.type === "stack") return planStackHeight(node);
  if (node.type === "decision") return decisionHeight(node);
  return heights[node.type];
}
