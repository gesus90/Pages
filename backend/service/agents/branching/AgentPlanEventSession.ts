import { AgentError } from "@/backend/error/AgentErrors";

import type { AcpProviderId } from "@/definition/AgentConfiguration";
import type { AgentPlanEventSessionLink } from "@/definition/AgentPlanSession";
import type {
  AgentPlanGroupSessions,
  GroupSessionResume,
} from "../AgentPlanGroupSessions";
import type { NodeRun } from "../AgentPlanStepContext";

/**
 * Decides whether an event continues the open session or has to start a new one.
 *
 * @param groups - The sessions the run holds open.
 * @param node - The start of the node that an event may have caused.
 * @param key - The run and node, as `runId/nodeId`.
 * @throws {AgentError} `plan_closeout_failed` when the session that is replaced
 * cannot be confirmed closed; no second session opens beside a leftover.
 *
 * @remarks
 * An open session, or one the adapter can resume natively on a retry, takes the
 * event as a follow-up prompt. Otherwise the earlier session is ended and the
 * start opens a new one that carries the main instruction as well; the record
 * names it as recovered, never as the same session.
 */
export async function openEventTurn(
  groups: AgentPlanGroupSessions,
  node: NodeRun,
  key: string,
): Promise<void> {
  const isUsable = groups.isOpen(key) || node.retryResumeSessionId !== null;
  if (!node.event) {
    node.eventMode = null;
    // A first start whose session ended on a technical error opens a clean one, as a plain agent does.
    if (node.receivesEvents && !isUsable) await discardSession(groups, key);
    return;
  }
  if (isUsable) {
    node.eventMode = "continued";
    return;
  }
  node.eventMode = "recovered";
  await discardSession(groups, key);
}

async function discardSession(
  groups: AgentPlanGroupSessions,
  key: string,
): Promise<void> {
  const closed = await groups.discard(key);
  if (closed !== null && !closed.isConfirmed)
    throw new AgentError("plan_closeout_failed");
}

/** Records whether a start of an event agent opened its session, continued it or replaced it. */
export function eventSessionLink(
  groups: AgentPlanGroupSessions,
  node: NodeRun,
  terms: {
    readonly key: string;
    readonly adapter: AcpProviderId;
    readonly resume?: GroupSessionResume;
  },
): AgentPlanEventSessionLink {
  const stepId = node.step.step.id;
  const shared = groups.link(
    terms.key,
    { groupId: stepId, stepId, adapter: terms.adapter },
    terms.resume,
  );
  return {
    activation: node.event?.activation ?? 1,
    role: node.eventMode === "recovered" ? "recovered" : shared.role,
    turn: shared.turn,
    acpSessionId: shared.acpSessionId,
    sourceStepId: node.event?.sourceStepIds[0] ?? null,
  };
}
