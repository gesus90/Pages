import { closeoutFailureCode } from "./AgentPlanSessionRecords";

import type { PlanSessionClosed } from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";

/** Records retirement for every retained member without turning failed work into success. */
export function retiredPlanGroupSession(
  record: AgentPlanSessionRecord | null,
  closed: PlanSessionClosed,
  reason: string,
): Partial<AgentPlanSessionRecord> {
  let resultCode: AgentPlanSessionRecord["resultCode"] = -1;
  if (closeoutFailureCode(closed) === null)
    resultCode =
      record?.resultCode ??
      (record?.acceptance?.verdict === "accepted" ? 0 : -1);
  return {
    closeout: closed.isConfirmed ? "confirmed" : "failed",
    endedAt: closed.endedAt,
    exit: closed.exit,
    leftoverProcesses: closed.leftovers,
    resultCode,
    events: [...(record?.events ?? []), `resource session retired: ${reason}`],
  };
}
