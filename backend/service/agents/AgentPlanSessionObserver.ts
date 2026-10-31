import { closeoutFailureCode } from "./AgentPlanSessionRecords";
import { sanitizePlanOutput } from "./AgentPlanOutput";

import type { PlanSessionObserver } from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";

interface ObservedPlanNode {
  readonly record: AgentPlanSessionRecord | null;
  hasStarted: boolean;
}

/** Keeps session observations scoped to one attempt and its durable record writer. */
export function createPlanSessionObserver(
  node: ObservedPlanNode,
  complete: (changes: Partial<AgentPlanSessionRecord>) => Promise<void>,
): PlanSessionObserver {
  const attemptId = node.record?.attemptId;
  // A late or repeated event of an earlier attempt must never overwrite the newer attempt.
  const isCurrent = (): boolean =>
    attemptId === undefined || node.record?.attemptId === attemptId;
  const write = (changes: Partial<AgentPlanSessionRecord>): void => {
    if (isCurrent()) void complete(changes);
  };
  return {
    activity: (activity) => {
      write({ activity });
    },
    capabilities: (continuationCapabilities) => {
      write({ continuationCapabilities });
    },
    retired: (closed, reason) => {
      write({
        closeout: closed.isConfirmed ? "confirmed" : "failed",
        containment: closed.isConfirmed ? closed.containment : undefined,
        endedAt: closed.endedAt,
        exit: closed.exit,
        leftoverProcesses: closed.leftovers,
        resultCode: closeoutFailureCode(closed) === null ? 0 : -1,
        events: [
          ...(node.record?.events ?? []),
          `resource session retired: ${reason}`,
        ],
      });
    },
    started: (details) => {
      if (!isCurrent()) return;
      node.hasStarted = true;
      if (!node.record) return;
      write({
        mode: details.mode,
        processId: details.processId,
        ...(details.namespace ? { namespace: details.namespace } : {}),
        startedAt: details.startedAt,
        requested: {
          ...node.record.requested,
          unattended: details.unattended,
        },
        effective: { arguments: details.arguments.join(" ").slice(0, 2_000) },
      });
    },
    identified: (sessionId) => {
      const group = node.record?.group;
      const loop = node.record?.loop;
      write({
        sessionId,
        ...(group ? { group: { ...group, acpSessionId: sessionId } } : {}),
        ...(loop ? { loop: { ...loop, acpSessionId: sessionId } } : {}),
      });
    },
    progressed: (events) => {
      write({
        events: events.map((line) => sanitizePlanOutput(line)),
      });
    },
  };
}
