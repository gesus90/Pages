import { closeLease } from "./resources/AcpLeaseProcesses";
import { logCaughtError } from "@/backend/logging/Logger";

import type { PlanSession } from "@/backend/agents/AgentPlanExecution";
import type {
  AcpResourceOwner,
  AcpResourceRecord,
  AcpResourceState,
} from "@/definition/AcpResource";
import type { AcpResourceStore } from "./resources/AcpResourceStore";
import type { SchedulerDependencies } from "./resources/AcpSchedulerDependencies";

/** The scheduler state that closing out leases reads and changes, always inside its serial writes. */
export interface AcpLeaseReconcilerHost {
  readonly store: AcpResourceStore;
  readonly active: Map<string, AcpResourceRecord>;
  readonly sessions: ReadonlyMap<string, PlanSession>;
  unverifiedLocal(): ReadonlySet<string>;
  readonly cleanup: NonNullable<SchedulerDependencies["cleanup"]>;
  readonly settleUnits: SchedulerDependencies["settleUnits"];
  persist<Result>(task: () => Promise<Result>): Promise<Result>;
  transition(instanceId: string, state: AcpResourceState): Promise<void>;
  finish(instanceId: string, isConfirmed: boolean): Promise<boolean>;
}

/** Which recovered leases keep their state, and which were adopted from a legacy owner. */
interface RecoveryContext {
  readonly preserved: ReadonlySet<string>;
  readonly retained: ReadonlySet<string>;
  readonly adopted: ReadonlySet<string>;
}

/**
 * Closes out the leases whose processes could not be confirmed ended: startup
 * recovery, the periodic reconciliation and the proof of chat leases.
 *
 * @remarks
 * Every write goes through the host, so a closeout runs inside the scheduler's
 * serial writes and sees the same lease state as admission.
 */
export class AcpLeaseReconciler {
  private readonly host: AcpLeaseReconcilerHost;

  public constructor(host: AcpLeaseReconcilerHost) {
    this.host = host;
  }

  /**
   * Adopts the leases known at startup and recovers each active lease once.
   *
   * @param previous - Durable leases of this process role.
   * @param legacyOwners - Interrupted sessions from before the lease journal.
   * @param context - Leases whose state an earlier step preserved or retained.
   */
  public async recoverStartup(
    previous: readonly AcpResourceRecord[],
    legacyOwners: readonly AcpResourceOwner[],
    context: {
      readonly preserved: ReadonlySet<string>;
      readonly retained: ReadonlySet<string>;
    },
  ): Promise<void> {
    for (const record of previous)
      this.host.active.set(record.instanceId, record);
    // An adopted lease is dated now, after its processes started, so its start rules nothing out.
    const adopted = new Set<string>();
    for (const owner of legacyOwners) {
      if (this.host.active.has(owner.instanceId)) continue;
      const record: AcpResourceRecord = {
        ...owner,
        state: "starting",
        since: new Date().toISOString(),
      };
      this.host.active.set(record.instanceId, record);
      adopted.add(record.instanceId);
      await this.host.persist(() => this.host.store.save(record));
    }
    for (const record of this.host.active.values())
      await this.recoverRecord(record, { ...context, adopted });
  }

  /**
   * Checks uncertain leases and releases each one whose processes are proven gone.
   *
   * @param runId - Only the leases of this plan run; `undefined` checks every uncertain lease.
   * @returns How many leases stay uncertain.
   */
  public async reconcile(runId?: string): Promise<number> {
    const uncertain = [...this.host.active.values()].filter(
      (record) =>
        record.state === "cleanup_failed" &&
        !this.host.sessions.has(record.instanceId) &&
        (runId === undefined || record.runId === runId),
    );
    let remaining = 0;
    for (const record of uncertain) {
      let isConfirmed = false;
      try {
        isConfirmed =
          (await this.cleanupRecord(record, record.since)).remaining === 0;
      } catch (caughtError: unknown) {
        logCaughtError("AcpResourceScheduler", caughtError);
      }
      if (!(await this.host.finish(record.instanceId, isConfirmed)))
        remaining += 1;
    }
    return remaining;
  }

  /**
   * Ends the processes of one lease and reports how many of them remain.
   *
   * @param record - A lease of this process role.
   * @param startedAt - Its recorded start, or `null` when the start is unknown.
   * @throws When the lease belongs to an unverified local owner.
   */
  public async cleanupRecord(
    record: AcpResourceRecord,
    startedAt: string | null,
  ): Promise<{ readonly remaining: number }> {
    if (this.host.unverifiedLocal().has(record.instanceId))
      throw new Error(
        "Local native owner is unverified; no cleanup is authorized",
      );
    return closeLease(
      record,
      startedAt,
      this.host.cleanup,
      this.host.settleUnits,
    );
  }

  /**
   * A chat lease whose native closeout stayed unconfirmed is proven from its identity and units.
   *
   * @param instanceId - The lease to prove.
   * @returns Whether no process of the lease remains.
   */
  public async settleChatLease(instanceId: string): Promise<boolean> {
    const record = this.host.active.get(instanceId);
    if (!record) return true;
    if (record.runId !== null) return false;
    return (await this.cleanupRecord(record, record.since)).remaining === 0;
  }

  private async recoverRecord(
    record: AcpResourceRecord,
    context: RecoveryContext,
  ): Promise<void> {
    if (context.preserved.has(record.instanceId)) {
      if (record.state === "closing" || record.state === "cleanup_failed")
        await this.host.transition(record.instanceId, "running");
      return;
    }
    if (context.retained.has(record.instanceId)) {
      await this.host.transition(record.instanceId, "cleanup_failed");
      return;
    }
    try {
      const cleanup = await this.cleanupRecord(
        record,
        context.adopted.has(record.instanceId) ? null : record.since,
      );
      await this.host.finish(record.instanceId, cleanup.remaining === 0);
    } catch (caughtError: unknown) {
      logCaughtError("AcpResourceScheduler", caughtError);

      await this.host.transition(record.instanceId, "cleanup_failed");
    }
  }
}
