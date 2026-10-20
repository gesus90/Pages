import { closeoutFailureCode } from "./AgentPlanSessionRecords";
import { sanitizePlanOutput } from "./AgentPlanOutput";

import type { PlanSessionObserver } from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";

interface ObservedPlanNode {
  readonly record: AgentPlanSessionRecord | null;
  hasStarted: boolean;
}

/** Keeps session observations scoped to one node and its durable record writer. */
export function createPlanSessionObserver(
  node: ObservedPlanNode,
  complete: (changes: Partial<AgentPlanSessionRecord>) => Promise<void>,
): PlanSessionObserver {
  return {
    activity: (activity) => {
      void complete({ activity });
    },
    capabilities: (continuationCapabilities) => {
      void complete({ continuationCapabilities });
    },
    retired: (closed, reason) => {
      void complete({
        closeout: closed.isConfirmed ? "confirmed" : "failed",
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
      node.hasStarted = true;
      if (!node.record) return;
      void complete({
        mode: details.mode,
        processId: details.processId,
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
      void complete({
        sessionId,
        ...(group ? { group: { ...group, acpSessionId: sessionId } } : {}),
        ...(loop ? { loop: { ...loop, acpSessionId: sessionId } } : {}),
      });
    },
    progressed: (events) => {
      void complete({
        events: events.map((line) => sanitizePlanOutput(line)),
      });
    },
  };
}
