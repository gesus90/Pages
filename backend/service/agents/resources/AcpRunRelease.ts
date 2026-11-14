import type { AcpResourceRecord } from "@/definition/AcpResource";
import type { WaitingRequest } from "./AcpAdmissionRequest";

interface ForcedRunReleaseContext {
  readonly active: ReadonlyMap<string, AcpResourceRecord>;
  readonly waiting: readonly WaitingRequest[];
  readonly pausedRuns: Set<string>;
  readonly finish: (
    instanceId: string,
    isConfirmed: boolean,
  ) => Promise<boolean>;
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
