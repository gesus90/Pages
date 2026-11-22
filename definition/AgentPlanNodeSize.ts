import { planGroupContent } from "./AgentPlanGroupLoop";
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
/**
 * The width of every node card: agents, scripts, swarms, value sources,
 * assets, stacks, decisions, Jumps and signals share one card family.
 */
export const PLAN_CARD_WIDTH = 340;
// The heights count the rows of plan-node-card and its 1 px border: the 66
// px header, the body with 26 px above and 14 px below its rows, rows of 32
// px 6 px apart, the 34 px execution line, the 64 px footer and the 36 px
// hint line, each line with its 1 px rule.
const CARD_HEADER = 68;
const CARD_BODY_PADDING = 40;
const CARD_ROW = 32;
const CARD_ROW_GAP = 6;
const CARD_EXECUTION = 35;
const CARD_FOOTER = 65;
const CARD_HINT = 37;
/** The compact logic node, now as wide as every card. */
export const PLAN_DECISION_WIDTH = PLAN_CARD_WIDTH;
/** The pill of a start or an end. */
const PLAN_ENDPOINT_WIDTH = 170;
const PLAN_ENDPOINT_HEIGHT = 56;
// The preview, the file name and the meta line of an asset below its row.
const ASSET_PREVIEW_HEIGHT = 96 + 18 + 16 + 3 * CARD_ROW_GAP;
// The row of a decision output, and the question and model lines of a model decision.
const DECISION_OUTPUT_ROW = 40;
const DECISION_MODEL_HEIGHT = 56;
/** The Stack card, as wide as every card. */
export const PLAN_STACK_WIDTH = PLAN_CARD_WIDTH;
// The file drop row and the row that adds a ticket below the entries.
const STACK_ADD_ROWS = CARD_ROW_GAP + 36 + CARD_ROW_GAP + CARD_ROW;
// One entry of the list with its gap, and the row of an empty list.
const STACK_ENTRY_HEIGHT = 32;
const STACK_EMPTY_HEIGHT = CARD_ROW_GAP + 28;
// The swarm footer: one row of 40 px fields and 12 px inset, each further
// row of helper fields 48 px. The first row holds the main model and two
// helpers, every further row four.
const SWARM_FOOTER = CARD_FOOTER;
const SWARM_FOOTER_ROW = 48;
const SWARM_FIRST_ROW_HELPERS = 2;
const SWARM_ROW_HELPERS = 4;
/** The two-line header of a loop or group container with its 1 px rule. */
export const PLAN_FRAME_HEADER = 77;
// The dashed member area begins 14 px below the header and 14 px inside the
// container edge; its 1.5 px edge and 16 px inset lead to the members,
// rounded to whole pixels.
const FRAME_AREA_GAP = 14;
const FRAME_AREA_INSET = 17;
/** Space between a frame's edge and its members: the area's margin, edge and inset. */
export const PLAN_FRAME_PADDING = 32;
const FRAME_MIN_WIDTH = 680;
export const PLAN_GROUP_COMPACT_WIDTH = 310;
export const PLAN_GROUP_COMPACT_HEIGHT = 115;
// The member area is at least 120 px high with its edge and inset.
const FRAME_MIN_MEMBER_AREA = 104;
const FRAME_MEMBER_BOTTOM_GAP = 18;
/** The line 8 px below the member area that counts the members, with the 14 px below it. */
export const PLAN_FRAME_FOOTER = 38;

/** The height of a column of rows; a column always holds at least one row. */
export function planCardRowsHeight(rows: number): number {
  const count = Math.max(1, rows);
  return count * CARD_ROW + (count - 1) * CARD_ROW_GAP;
}

/** Header, body padding and rows: the height of a card before its lines below the body. */
function cardHeight(rows: number): number {
  return CARD_HEADER + CARD_BODY_PADDING + planCardRowsHeight(rows);
}

/**
 * An agent card: its inputs and the event input on the left, its text and
 * boolean result on the right, the execution line and the model footer.
 */
function agentHeight(step: AgentPlanStep, sources: AgentPlanSources): number {
  const inputs = planStepTemplate(step, sources.agents)?.parameters.length ?? 0;
  return cardHeight(Math.max(inputs + 1, 2)) + CARD_EXECUTION + CARD_FOOTER;
}

/** A script card has the lines of an agent card: its inputs, its output and its profile. */
function scriptHeight(script: AgentPlanScript): number {
  return cardHeight(script.inputs.length) + CARD_EXECUTION + CARD_FOOTER;
}

/**
 * Space above the members of a frame: its two-line header, the gap above
 * the dashed member area, and the area's edge and inset.
 * @remarks
 * A loop and a group share the header since both show their flow and
 * session marks in its second line.
 */
export function planGroupHeaderHeight(): number {
  return PLAN_FRAME_HEADER + FRAME_AREA_GAP + FRAME_AREA_INSET;
}

/**
 * The height of the Stack card for its entries.
 * @param stack - The stack whose entries are listed on its card.
 */
export function planStackHeight(stack: AgentPlanStack): number {
  // The trigger IN on the left, Content and Count on the right, then the
  // entries, the rows that add one and the summary line.
  const entries =
    stack.entries.length === 0
      ? STACK_EMPTY_HEIGHT
      : CARD_ROW_GAP + stack.entries.length * STACK_ENTRY_HEIGHT - 4;
  return cardHeight(2) + entries + STACK_ADD_ROWS + CARD_HINT;
}

/** A decision grows with its outputs and, as a model decision, with its question and model. */
function decisionHeight(decision: AgentPlanDecision): number {
  const outputs = Math.max(1, planDecisionOutputPorts(decision).length);
  const outputColumn =
    outputs * DECISION_OUTPUT_ROW + (outputs - 1) * CARD_ROW_GAP;
  return (
    CARD_HEADER +
    CARD_BODY_PADDING +
    Math.max(planCardRowsHeight(2), outputColumn) +
    (planDecisionMode(decision) === "model" ? DECISION_MODEL_HEIGHT : 0) +
    CARD_HINT
  );
}

/** What a frame shows: its members and its decisions. */
type FrameContent =
  | AgentPlanStep
  | AgentPlanScript
  | AgentPlanGroup
  | AgentPlanLoop
  | AgentPlanDecision;

function frameContent(group: PlanFrame): readonly FrameContent[] {
  return [
    ...(group.type === "group" ? planGroupContent(group) : group.steps),
    ...(group.decisions ?? []),
  ];
}

function memberHeight(member: FrameContent, sources: AgentPlanSources): number {
  if (member.type === "group" || member.type === "loop")
    return groupHeight(member, sources);
  if (member.type === "decision") return decisionHeight(member);
  return member.type === "script"
    ? scriptHeight(member)
    : agentHeight(member, sources);
}

function memberWidth(member: FrameContent): number {
  if (member.type === "decision") return PLAN_DECISION_WIDTH;
  return member.type === "group" || member.type === "loop"
    ? planGroupWidth(member)
    : PLAN_CARD_WIDTH;
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
    planGroupHeaderHeight() +
    Math.max(FRAME_MIN_MEMBER_AREA, bottom + FRAME_MEMBER_BOTTOM_GAP) +
    PLAN_FRAME_FOOTER
  );
}

/** The top left corner of a frame's member area; member positions count from here. */
export function planMemberOrigin(group: PlanFrame): AgentPlanPosition {
  return {
    x: group.x + PLAN_FRAME_PADDING,
    y: group.y + planGroupHeaderHeight(),
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

/** The least height of a Jump card and of a signal card, before their ports are counted. */
const PLAN_JUMP_CARD_HEIGHT = cardHeight(2) + CARD_HINT;
const PLAN_SIGNAL_CARD_HEIGHT = cardHeight(2);

/**
 * The height of a swarm card: header, the task row, and the footer with the
 * main model and one 58 px field per helper, wrapping into further rows.
 */
export function planSwarmHeight(workerCount: number): number {
  const wrapped = Math.max(0, workerCount - SWARM_FIRST_ROW_HELPERS);
  const rows = Math.ceil(wrapped / SWARM_ROW_HELPERS);
  return cardHeight(1) + SWARM_FOOTER + rows * SWARM_FOOTER_ROW;
}

/** Cards keep their stored top left corner; only their size follows the card type. */
export function planNodeWidth(node: AgentPlanNode): number {
  if (node.type === "group" || node.type === "loop")
    return planGroupWidth(node);
  return node.type === "start" || node.type === "end"
    ? PLAN_ENDPOINT_WIDTH
    : PLAN_CARD_WIDTH;
}

/**
 * Bounds size React Flow nodes and keep group membership hit areas consistent.
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
    parameter: cardHeight(3),
    task: cardHeight(1),
    variable: cardHeight(1),
    asset: cardHeight(1) + ASSET_PREVIEW_HEIGHT,
  };
  if (node.type === "group" || node.type === "loop")
    return groupHeight(node, sources);
  if (node.type === "agent") return agentHeight(node, sources);
  if (node.type === "script") return scriptHeight(node);
  if (node.type === "git_closeout") return cardHeight(1) + 49;
  if (node.type === "stack") return planStackHeight(node);
  if (node.type === "decision") return decisionHeight(node);
  if (node.type === "swarm") return planSwarmHeight(node.workers.count);
  // The exact height follows the ports of the stored configuration, see planLayoutHeight.
  if (node.type === "jump") return PLAN_JUMP_CARD_HEIGHT;
  if (node.type === "signal") return PLAN_SIGNAL_CARD_HEIGHT;
  return heights[node.type];
}
