import { AcpLeaseAudit } from "./AcpLeaseAudit";

import type { PlanSession } from "@/backend/agents/AgentPlanExecution";
import type {
  AcpLeaseCheckReason,
  AcpLeaseLifecycle,
  AcpRecoveryScope,
  AcpResourceRecord,
  AcpResourceSnapshot,
} from "@/definition/AcpResource";
import type { AcpResourceStore } from "./AcpResourceStore";
import type { AcpStartLifecycle } from "./AcpStartLifecycle";

type DescribedLease = AcpResourceSnapshot["active"][number];

/** The scheduler state the lease checks read and change, always inside its serial writes. */
export interface AcpLeaseCheckHost {
  readonly store: AcpResourceStore;
  readonly scope: AcpRecoveryScope;
  readonly active: Map<string, AcpResourceRecord>;
  readonly sessions: ReadonlyMap<string, PlanSession>;
  readonly pausedRuns: ReadonlySet<string>;
  unverifiedLocal(): ReadonlySet<string>;
  persist<Result>(task: () => Promise<Result>): Promise<Result>;
  /** Lets waiting requests use capacity a released lease freed. */
  wake(): void;
}

/**
 * Lifecycle evidence of starting leases and the periodic check of unconfirmed
 * ones, kept apart from admission (PAGE-264).
 *
 * @remarks
 * Every write goes through the scheduler's serial queue and checks the
 * current lease first, so a check never contradicts a closeout, a recovery
 * or an adoption that happened meanwhile.
 */
export class AcpLeaseChecks {
  private readonly host: AcpLeaseCheckHost;
  private readonly audit: AcpLeaseAudit;
  private readonly openingIds = new Set<string>();
  /** Starts whose callback records process creation, so a failure before it proves no spawn. */
  private readonly spawnTracked = new Set<string>();

  public constructor(host: AcpLeaseCheckHost) {
    this.host = host;
    this.audit = new AcpLeaseAudit(
      {
        candidates: () =>
          [...host.active.values()].filter((record) => this.isIdle(record)),
        isUnverifiedLocal: (instanceId) =>
          host.unverifiedLocal().has(instanceId),
        release: (instanceId) => this.release(instanceId),
        retain: (instanceId, reason) => this.retain(instanceId, reason),
      },
      host.scope,
    );
  }

  /** Starts the periodic check after startup recovery. */
  public start(): void {
    this.audit.start();
  }

  /** Stops the periodic check with the service. */
  public stop(): Promise<void> {
    return this.audit.stop();
  }

  /** The periodic check, for the resource view. */
  public summary(): AcpResourceSnapshot["check"] {
    return this.audit.summary();
  }

  /** Marks a start in progress; the check leaves its lease alone until it settles. */
  public opening(instanceId: string): () => void {
    this.openingIds.add(instanceId);
    return () => {
      this.openingIds.delete(instanceId);
      this.spawnTracked.delete(instanceId);
    };
  }

  /** The lifecycle handle a start callback receives. */
  public lifecycle(instanceId: string): AcpStartLifecycle {
    return {
      trackSpawn: () => {
        this.spawnTracked.add(instanceId);
      },
      beforeSpawn: () => this.record(instanceId, "spawning"),
    };
  }

  /**
   * Marks a tracked start that failed before recording process creation.
   *
   * @returns Whether the start provably spawned nothing; the lease then keeps
   * `not_spawned` as evidence if its release fails.
   */
  public markNotSpawned(
    instanceId: string,
    native: PlanSession | null,
  ): boolean {
    const current = this.host.active.get(instanceId);
    if (
      native !== null ||
      !this.spawnTracked.has(instanceId) ||
      current?.lifecycle !== "reserved"
    )
      return false;
    this.host.active.set(instanceId, {
      ...current,
      lifecycle: "not_spawned",
    });
    return true;
  }

  /** Adds the process facts and the last check to a lease of any service. */
  public describe(record: AcpResourceRecord): DescribedLease {
    const own = this.host.active.get(record.instanceId);
    const check = own?.check ?? record.check ?? null;
    let process: DescribedLease["process"] = "unknown";
    if (
      this.host.sessions.has(record.instanceId) ||
      check?.reason === "process_alive" ||
      check?.reason === "unit_active"
    )
      process = "confirmed";
    else if (own?.state === "starting" && own.lifecycle === "reserved")
      process = "none";
    return {
      ...record,
      check,
      isPaused: record.runId !== null && this.host.pausedRuns.has(record.runId),
      process,
    };
  }

  /** Persists lifecycle evidence; the caller spawns only after this resolved. */
  private async record(
    instanceId: string,
    lifecycle: AcpLeaseLifecycle,
  ): Promise<void> {
    await this.host.persist(async () => {
      const current = this.host.active.get(instanceId);
      if (current?.state !== "starting")
        throw new Error("ACP reservation is not starting");
      if (current.lifecycle === lifecycle) return;
      const record = { ...current, lifecycle };
      await this.host.store.save(record);
      this.host.active.set(instanceId, record);
    });
  }

  /** An unconfirmed lease that no live, opening or adopted session of this process holds. */
  private isIdle(record: AcpResourceRecord): boolean {
    return (
      record.state === "cleanup_failed" &&
      !this.host.sessions.has(record.instanceId) &&
      !this.openingIds.has(record.instanceId)
    );
  }

  /** Releases a checked lease idempotently and only while it is still idle and unconfirmed. */
  private async release(instanceId: string): Promise<boolean> {
    const { store } = this.host;
    const released = await this.host.persist(async () => {
      const current = this.host.active.get(instanceId);
      if (!current || !this.isIdle(current)) return false;
      const result = store.releaseUncertain
        ? await store.releaseUncertain(instanceId)
        : await store.remove(instanceId).then(() => "released" as const);
      if (result === "changed") return false;
      this.host.active.delete(instanceId);
      return true;
    });
    if (released) this.host.wake();
    return released;
  }

  private async retain(
    instanceId: string,
    reason: AcpLeaseCheckReason,
  ): Promise<void> {
    await this.host.persist(async () => {
      const current = this.host.active.get(instanceId);
      if (!current || !this.isIdle(current)) return;
      const check = { reason, at: new Date().toISOString() };
      await this.host.store.recordCheck?.(instanceId, check);
      this.host.active.set(instanceId, { ...current, check });
    });
  }
}
