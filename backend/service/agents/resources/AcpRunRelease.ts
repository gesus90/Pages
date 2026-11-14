import { logCaughtError } from "@/backend/logging/Logger";

import type { AcpResourceRecord } from "@/definition/AcpResource";
import type { PlanSession } from "@/backend/agents/AgentPlanExecution";
import type { WaitingRequest } from "./AcpAdmissionRequest";

interface RunReleaseContext {
  readonly active: ReadonlyMap<string, AcpResourceRecord>;
  readonly sessions: ReadonlyMap<string, PlanSession>;
  readonly cleanup: (
    record: AcpResourceRecord,
    since: string,
  ) => Promise<{ readonly remaining: number }>;
  readonly finish: (
    instanceId: string,
    isConfirmed: boolean,
  ) => Promise<boolean>;
}

interface ForcedRunReleaseContext {
  readonly active: ReadonlyMap<string, AcpResourceRecord>;
  readonly waiting: readonly WaitingRequest[];
  readonly pausedRuns: Set<string>;
  readonly finish: RunReleaseContext["finish"];
}

/** Cancels the replaced run's waiters and releases its capacity independently of process confirmation. */
export async function forceReleaseAcpRun(
  runId: string,
  context: ForcedRunReleaseContext,
): Promise<boolean> {
  context.pausedRuns.delete(runId);
  for (const request of [...context.waiting])
    if (request.owner.runId === runId) request.abort();
  let isReleased = true;
  for (const record of [...context.active.values()])
    if (
      record.runId === runId &&
      !(await context.finish(record.instanceId, true))
    )
      isReleased = false;
  return isReleased;
}

/** Rechecks an ended run's uncertain capacity without releasing any unproven process. */
export async function reconcileAcpRun(
  runId: string | undefined,
  context: RunReleaseContext,
): Promise<number> {
  const uncertain = [...context.active.values()].filter(
    (record) =>
      record.state === "cleanup_failed" &&
      !context.sessions.has(record.instanceId) &&
      (runId === undefined || record.runId === runId),
  );
  let remaining = 0;
  for (const record of uncertain) {
    let isConfirmed = false;
    try {
      isConfirmed =
        (await context.cleanup(record, record.since)).remaining === 0;
    } catch (error: unknown) {
      logCaughtError("AcpRunRelease", error);
    }
    if (!(await context.finish(record.instanceId, isConfirmed))) remaining += 1;
  }
  return remaining;
}
