import { hasPlanJumpTimeout, planEntryInputs } from "./AgentPlanJump";
import {
  PLAN_CARD_WIDTH,
  planCardRowsHeight,
  planNodeHeight,
  planNodeWidth,
} from "./AgentPlanNodeSize";

import type {
  AgentPlanNode,
  AgentPlanSources,
  AgentPlanStart,
  AgentPlanEnd,
} from "./AgentPlan";
import type { AgentPlanJump, AgentPlanSignal } from "./AgentPlanJump";

/** The width of the Jump card: two columns of ports, inputs left and outputs right. */
export const PLAN_JUMP_WIDTH = PLAN_CARD_WIDTH;
/** The width of the signal card. */
export const PLAN_SIGNAL_WIDTH = PLAN_CARD_WIDTH;
/** The width of a start or end that shows value ports below its pill. */
const PLAN_ENDPOINT_PORT_WIDTH = 220;
// A card's header with its border and the body padding; see AgentPlanNodeSize.
const CARD_HEADER = 68;
const CARD_BODY_PADDING = 40;
const CARD_ROW_GAP = 6;
const CARD_HINT = 37;
// The target line of an outgoing Jump, the entry line of a receiving one
// and the signal line of a shown run are no rows; a stored plan has none.
const JUMP_OUT_TARGET = 18 + CARD_ROW_GAP;
const JUMP_IN_SUMMARY = 16;
// The note below the ports of an outgoing Jump whose failure output is not connected.
const JUMP_OUT_NOTICE = CARD_ROW_GAP + 40;
const ENDPOINT_HEIGHT = 56;
// The gap below the pill and the 8 px inset and 1 px edge of the box of rows.
const ENDPOINT_PORT_GAP = 12;
const ENDPOINT_PORT_BOX = 18;

/** How many port rows each side of a card holds. */
export interface PlanPortRows {
  readonly inputs: number;
  readonly outputs: number;
}

/**
 * The rows of ports a Jump card shows, as its stored configuration decides.
 * @param node - A receiving or an outgoing Jump.
 * @remarks
 * The flow ports are dots on the card header, never rows. A receiving Jump
 * offers one value output per declared input. An outgoing Jump has one value
 * input per declared target input on the left; on the right the error
 * output, the timeout output of a finite wait, the run id, the reason and
 * the returns or the payload of the wait it makes.
 */
export function planJumpPortRows(node: AgentPlanJump): PlanPortRows {
  if (node.direction === "in")
    return { inputs: 0, outputs: node.inputs.length };
  const failures = hasPlanJumpTimeout(node) ? 2 : 1;
  const values =
    2 +
    (node.wait === "completion" ? node.returns.length : 0) +
    (node.wait === "signal" ? 1 : 0);
  return { inputs: node.inputs.length, outputs: failures + values };
}

/** The rows of a signal: its name and, with a payload, its value input. */
function signalPortRows(node: AgentPlanSignal): PlanPortRows {
  return { inputs: node.payloadType ? 2 : 1, outputs: 0 };
}

/** The height of a column of rows, or nothing when neither side has a row. */
function portRowsHeight(rows: PlanPortRows): number {
  const count = Math.max(rows.inputs, rows.outputs);
  return count === 0 ? 0 : planCardRowsHeight(count);
}

/** The value rows below the title row of a start or an end; zero keeps the compact pill. */
function endpointRows(node: AgentPlanStart | AgentPlanEnd): number {
  if (node.type === "end") return node.returns?.length ?? 0;
  return node.callable === true ? planEntryInputs(node).length : 0;
}

function jumpHeight(node: AgentPlanJump): number {
  const body = portRowsHeight(planJumpPortRows(node));
  const rows = body === 0 ? 0 : CARD_ROW_GAP + body;
  return node.direction === "in"
    ? CARD_HEADER + CARD_BODY_PADDING + JUMP_IN_SUMMARY + rows
    : CARD_HEADER +
        CARD_BODY_PADDING +
        JUMP_OUT_TARGET +
        body +
        JUMP_OUT_NOTICE +
        CARD_HINT;
}

/**
 * The width a card of the plan has.
 * @param node - Any node of the plan.
 * @remarks
 * The Jump, the signal and a start or end with value ports are sized by their
 * stored configuration; every other node keeps the width of the card family.
 */
export function planLayoutWidth(node: AgentPlanNode): number {
  if (node.type === "jump") return PLAN_JUMP_WIDTH;
  if (node.type === "signal") return PLAN_SIGNAL_WIDTH;
  if ((node.type === "start" || node.type === "end") && endpointRows(node) > 0)
    return PLAN_ENDPOINT_PORT_WIDTH;
  return planNodeWidth(node);
}

/**
 * The height a card of the plan is laid out with.
 * @param node - Any node of the plan.
 * @param sources - What sizes the cards: the agents, whose inputs make a card taller.
 * @remarks
 * A card is at least this tall and grows with its content.
 */
export function planLayoutHeight(
  node: AgentPlanNode,
  sources: AgentPlanSources,
): number {
  if (node.type === "jump") return jumpHeight(node);
  if (node.type === "signal")
    return (
      CARD_HEADER + CARD_BODY_PADDING + portRowsHeight(signalPortRows(node))
    );
  if ((node.type === "start" || node.type === "end") && endpointRows(node) > 0)
    return (
      ENDPOINT_HEIGHT +
      ENDPOINT_PORT_GAP +
      ENDPOINT_PORT_BOX +
      planCardRowsHeight(endpointRows(node))
    );
  return planNodeHeight(node, sources);
}
