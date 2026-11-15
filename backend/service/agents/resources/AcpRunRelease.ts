import type { PlanSession } from "@/backend/agents/AgentPlanExecution";
import type { AcpResourceRecord } from "@/definition/AcpResource";
import type { AcpResourceStore } from "./AcpResourceStore";
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

interface ResumeRunReleaseContext {
  readonly store: AcpResourceStore;
  readonly active: Map<string, AcpResourceRecord>;
  readonly sessions: Map<string, PlanSession>;
  persist(task: () => Promise<void>): Promise<void>;
  wake(): void;
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

/** Releases only the reservations of an ended run whose executor explicitly resumes it. */
export async function releaseAcpForResume(
  runId: string,
  context: ResumeRunReleaseContext,
): Promise<void> {
  await context.persist(async () => {
    const stored = await context.store.list();
    const records = new Map(
      [...stored, ...context.active.values()].map((record) => [
        record.instanceId,
        record,
      ]),
    );
    for (const record of records.values()) {
      if (record.runId !== runId) continue;
      await context.store.remove(record.instanceId);
      context.active.delete(record.instanceId);
      context.sessions.delete(record.instanceId);
    }
  });
  context.wake();
}
