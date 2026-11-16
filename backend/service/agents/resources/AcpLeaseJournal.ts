import { logCaughtError } from "@/backend/logging/Logger";
import type { PlanSession } from "@/backend/agents/AgentPlanExecution";
import type {
  AcpResourceRecord,
  AcpResourceState,
} from "@/definition/AcpResource";
import type { AcpResourceStore } from "./AcpResourceStore";

/**
 * The durable lease bookkeeping the journal writes for the scheduler.
 * @remarks
 * Every write runs through the scheduler's ordered background queue.
 */
export interface AcpLeaseJournalContext {
  readonly store: AcpResourceStore;
  readonly active: Map<string, AcpResourceRecord>;
  readonly sessions: Map<string, PlanSession>;
  persist<Result>(task: () => Promise<Result>): Promise<Result>;
  storageFailed(record: AcpResourceRecord, error: unknown): void;
  markStorageProblem(): void;
  wake(): void;
}

/** Saves a lease record and reports a failed write as a scheduler problem. */
export async function saveAcpActive(
  record: AcpResourceRecord,
  context: AcpLeaseJournalContext,
): Promise<void> {
  context.active.set(record.instanceId, record);
  await context.store.save(record).catch((caughtError: unknown) => {
    context.storageFailed(record, caughtError);
  });
}

/** Records a lease state change durably, in the order of the scheduler. */
export async function transitionAcpLease(
  instanceId: string,
  state: AcpResourceState,
  stepId: string | undefined,
  context: AcpLeaseJournalContext,
): Promise<void> {
  await context.persist(async () => {
    const current = context.active.get(instanceId);
    if (!current) return;
    const patch = stepId === undefined ? { state } : { state, stepId };
    await saveAcpActive({ ...current, ...patch }, context);
  });
}

/**
 * Removes a confirmed lease durably or marks it cleanup_failed, then wakes the queue.
 * @returns Whether the capacity is proven free again.
 */
export async function finishAcpLease(
  instanceId: string,
  isConfirmed: boolean,
  context: AcpLeaseJournalContext,
): Promise<boolean> {
  const released = await context.persist(async () => {
    const current = context.active.get(instanceId);
    if (!current) return true;
    context.sessions.delete(instanceId);
    if (isConfirmed) {
      try {
        await context.store.remove(instanceId);
        context.active.delete(instanceId);
        return true;
      } catch (caughtError: unknown) {
        logCaughtError("AcpResourceScheduler", caughtError);
        context.markStorageProblem();
      }
    }
    await saveAcpActive({ ...current, state: "cleanup_failed" }, context);
    return false;
  });
  context.wake();
  return released;
}
