import { hasPlanJumpTimeout, planEntryInputs } from "./AgentPlanJump";
import { planNodeHeight, planNodeWidth } from "./AgentPlanNodeSize";

import type {
  AgentPlanNode,
  AgentPlanSources,
  AgentPlanStart,
  AgentPlanEnd,
} from "./AgentPlan";
import type { AgentPlanJump, AgentPlanSignal } from "./AgentPlanJump";

/** The width of the Jump card: two columns of ports, inputs left and outputs right. */
export const PLAN_JUMP_WIDTH = 340;
/** The width of the signal card. */
export const PLAN_SIGNAL_WIDTH = 260;
/** The width of a start or end that shows value ports below its title row. */
const PLAN_ENDPOINT_PORT_WIDTH = 220;
const PORT_ROW = 32;
const CARD_HEADER = 48;
// The target and wait lines of an outgoing Jump, and the notice about an unconnected failure output.
const JUMP_OUT_SUMMARY = 64;
const JUMP_OUT_NOTICE = 48;
const JUMP_IN_SUMMARY = 28;
const SIGNAL_SUMMARY = 28;
const CARD_PADDING = 16;
const ENDPOINT_HEIGHT = 56;
const ENDPOINT_PORT_GAP = 12;

/** How many port rows each side of a card holds. */
export interface PlanPortRows {
  readonly inputs: number;
  readonly outputs: number;
}

/**
 * The rows of ports a Jump card shows, as its stored configuration decides.
 * @param node - A receiving or an outgoing Jump.
 * @remarks
 * A receiving Jump has no flow input and offers its flow output and one value
 * output per declared input. An outgoing Jump has its flow input and one value
 * input per declared target input on the left; on the right its normal exit,
 * the error output, the timeout output of a finite wait, the run id, the
 * reason and the returns or the payload of the wait it makes.
 */
export function planJumpPortRows(node: AgentPlanJump): PlanPortRows {
  if (node.direction === "in")
    return { inputs: 0, outputs: 1 + node.inputs.length };
  const failures = hasPlanJumpTimeout(node) ? 2 : 1;
  const values =
    2 +
    (node.wait === "completion" ? node.returns.length : 0) +
    (node.wait === "signal" ? 1 : 0);
  return {
    inputs: 1 + node.inputs.length,
    outputs: 1 + failures + values,
  };
}

/** The rows of a signal: its flow ports and, with a payload, its value input. */
function signalPortRows(node: AgentPlanSignal): PlanPortRows {
  return { inputs: node.payloadType ? 2 : 1, outputs: 1 };
}

/** The value rows below the title row of a start or an end; zero keeps the compact pill. */
function endpointRows(node: AgentPlanStart | AgentPlanEnd): number {
  if (node.type === "end") return node.returns?.length ?? 0;
  return node.callable === true ? planEntryInputs(node).length : 0;
}

function jumpHeight(node: AgentPlanJump): number {
  const rows = planJumpPortRows(node);
  const body = Math.max(rows.inputs, rows.outputs) * PORT_ROW;
  return node.direction === "in"
    ? CARD_HEADER + JUMP_IN_SUMMARY + body + CARD_PADDING
    : CARD_HEADER + JUMP_OUT_SUMMARY + body + JUMP_OUT_NOTICE + CARD_PADDING;
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
  if (node.type === "signal") {
    const rows = signalPortRows(node);
    return (
      CARD_HEADER +
      SIGNAL_SUMMARY +
      Math.max(rows.inputs, rows.outputs) * PORT_ROW +
      CARD_PADDING
    );
  }
  if ((node.type === "start" || node.type === "end") && endpointRows(node) > 0)
    return ENDPOINT_HEIGHT + ENDPOINT_PORT_GAP + endpointRows(node) * PORT_ROW;
  return planNodeHeight(node, sources);
}
