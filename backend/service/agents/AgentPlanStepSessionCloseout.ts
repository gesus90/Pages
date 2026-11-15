import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { AgentProviderError } from "@/backend/error/AgentProviderError";
import { agentToolFailureEvents } from "@/backend/service/agents/tools/AgentToolSession";

import { closePlanSession } from "./AgentPlanSessionCloseout";
import { retiredPlanGroupSession } from "./AgentPlanGroupRetirement";
import { closedSessionChanges } from "./AgentPlanSessionRecords";
import { failureCloseout, planNodeFailureResult } from "./AgentPlanStepFailure";

import type {
  PlanSession,
  PlanSessionClosed,
} from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
import type { AgentPlanGroupSessions } from "./AgentPlanGroupSessions";
import type { AgentPlanSessionAccess } from "./AgentPlanSessionAccess";
import type { AgentPlanSnapshot } from "./AgentPlanSnapshot";
import type { NodeRun } from "./AgentPlanStepContext";
import type { AgentSessionService } from "./sessions/AgentSessionService";

/** Shared step-runner state needed to close, retire, or fail retained plan sessions. */
export interface StepSessionCloseoutTarget {
  readonly groups: AgentPlanGroupSessions;
  readonly retained: Map<string, NodeRun[]>;
  readonly groupInputs: Map<string, Promise<AgentPlanSnapshot>>;
  readonly access: Pick<AgentPlanSessionAccess, "revoke">;
  readonly sessions?: Pick<AgentSessionService, "released" | "abandon">;
  readonly complete: (
    node: NodeRun,
    changes: Partial<AgentPlanSessionRecord>,
  ) => Promise<void>;
}

/** Ends the sessions of a group or loop agent, or of the whole run, and tells how each one closed. */
export async function closePlanSessionGroups(
  target: StepSessionCloseoutTarget,
  runId: string,
  groupId?: string,
  options?: { readonly abort?: boolean },
): Promise<Awaited<ReturnType<AgentPlanGroupSessions["stop"]>>> {
  const stopped = await target.groups.stop(runId, groupId, options);
  if (groupId === undefined) target.groups.forget(runId);
  for (const { key, closed } of stopped) {
    for (const node of target.retained.get(key) ?? []) {
      await target.sessions?.released(node.record);
      await target.complete(node, closedSessionChanges(closed));
    }
    target.retained.delete(key);
    await target.access.revoke(runId, key.slice(runId.length + 1));
  }
  for (const key of target.groupInputs.keys())
    if (
      key === `${runId}/${groupId}` ||
      (!groupId && key.startsWith(`${runId}/`))
    )
      target.groupInputs.delete(key);
  return stopped;
}

/** Closes one active plan step session and updates all retained group nodes sharing its key. */
export async function closePlanStepSession(
  target: StepSessionCloseoutTarget,
  node: NodeRun,
  session: PlanSession,
): ReturnType<typeof closePlanSession> {
  const key = `${node.run.id}/${node.sessionGroup ?? node.step.step.id}`;
  const closeout = await closePlanSession(session, node.record);
  const { closed } = closeout;
  await target.sessions?.released(node.record);
  target.groupInputs.delete(key);
  for (const previous of target.retained.get(key) ?? [])
    await target.complete(previous, closedSessionChanges(closed));
  target.retained.delete(key);
  await target.access.revoke(
    node.run.id,
    node.sessionGroup ?? node.step.step.id,
  );
  return closeout;
}

/** Retires retained group session members after the shared session closes externally. */
export async function retirePlanStepGroup(
  target: StepSessionCloseoutTarget,
  node: NodeRun,
  closed: PlanSessionClosed,
  reason: string,
): Promise<void> {
  const key = `${node.run.id}/${node.sessionGroup}`;
  const previous = target.retained.get(key) ?? [];
  const members = previous.includes(node) ? previous : [...previous, node];
  for (const member of members)
    await target.complete(
      member,
      retiredPlanGroupSession(member.record, closed, reason),
    );
  await target.sessions?.released(node.record);
  await target.access.revoke(
    node.run.id,
    node.sessionGroup ?? node.step.step.id,
  );
  target.retained.delete(key);
  target.groupInputs.delete(key);
}

/** Aborts any active group session, revokes step access, and records the terminal node failure. */
export async function failPlanStepNode(
  target: StepSessionCloseoutTarget,
  node: NodeRun,
  error: unknown,
): Promise<Partial<AgentPlanStepResult>> {
  const stopped = node.sessionGroup
    ? await closePlanSessionGroups(target, node.run.id, node.sessionGroup, {
        abort: true,
      })
    : [];
  await target.access.revoke(
    node.run.id,
    node.sessionGroup ?? node.step.step.id,
  );
  await target.sessions?.abandon(
    node.record,
    error instanceof AgentPlanCancelledError ? "cancelled" : "failed",
  );
  if (node.record)
    await target.complete(node, {
      ...(error instanceof AgentProviderError
        ? { providerFailure: error.failure }
        : {}),
      endedAt: new Date().toISOString(),
      closeout: failureCloseout(node, error, stopped.at(0)?.closed),
      resultCode: -1,
      events: agentToolFailureEvents(error, node.record.events),
    });
  return planNodeFailureResult(node, error);
}
