import { listRunningWorkerUnits } from "@/backend/agents/cli/CliWorkerUnit";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";

import { classifyLease, isReleaseReason } from "./AcpLeaseEvidence";

import type {
  AcpLeaseCheckReason,
  AcpLeaseCheckSummary,
  AcpRecoveryScope,
  AcpResourceRecord,
} from "@/definition/AcpResource";
import type { AcpLeaseEvidenceContext } from "./AcpLeaseEvidence";

/** The fixed rhythm of the periodic reservation check. */
export const ACP_LEASE_CHECK_INTERVAL_MS = 15 * 60_000;
/** The first check waits until startup recovery and the first requests settled. */
const FIRST_CHECK_DELAY_MS = 60_000;
/** A cycle that failed is repeated once sooner, never more often than this. */
const FAILED_CHECK_RETRY_MS = 5 * 60_000;
/** One cycle checks at most this many leases; the rest follow in the next one. */
const MAX_LEASES_PER_CHECK = 100;
/** A single lease that hangs must not hold the cycle. */
const LEASE_CHECK_TIMEOUT_MS = 15_000;

/** How the scheduler lets the check observe and release its own leases. */
export interface AcpLeaseAuditTarget {
  /** Unconfirmed leases of this process role that no live or opening session holds. */
  candidates(): readonly AcpResourceRecord[];
  isUnverifiedLocal(instanceId: string): boolean;
  /**
   * Releases a lease the evidence proved ended.
   *
   * @returns `false` when the lease changed or vanished meanwhile and was left alone.
   */
  release(instanceId: string): Promise<boolean>;
  /** Keeps a lease and stores why. */
  retain(instanceId: string, reason: AcpLeaseCheckReason): Promise<void>;
}

interface LeaseResult {
  readonly reason: AcpLeaseCheckReason;
  readonly isReleased: boolean;
}

interface CycleResult {
  readonly checked: number;
  readonly released: number;
  readonly unconfirmed: number;
  readonly failed: number;
  readonly reasons: Readonly<Partial<Record<AcpLeaseCheckReason, number>>>;
}

function withTimeout<Result>(task: Promise<Result>): Promise<Result> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("ACP lease check timed out"));
    }, LEASE_CHECK_TIMEOUT_MS);
    timer.unref();
  });
  return Promise.race([task, timeout]).finally(() => clearTimeout(timer));
}

function outcomeOf(result: CycleResult): AcpLeaseCheckSummary["outcome"] {
  if (result.failed > 0) return "failed";
  if (result.released > 0) return "released";
  if (result.unconfirmed > 0) return "unconfirmed";
  return "checked";
}

/**
 * Checks the unconfirmed ACP reservations of this service every 15 minutes,
 * model-free and without ending any process (PAGE-264).
 *
 * @remarks
 * The next cycle is scheduled only after the previous one ended, so cycles
 * never overlap and a long pause of the host causes one late cycle instead
 * of a catch-up burst. A failing lease is kept and does not stop the others.
 */
export class AcpLeaseAudit {
  private readonly target: AcpLeaseAuditTarget;
  private readonly scope: AcpRecoveryScope;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | null = null;
  private isStopped = false;
  private lastAt: string | null = null;
  private nextAt: string | null = null;
  private last: CycleResult | null = null;
  private hasCycleFailed = false;
  private hasLoggedCycleError = false;
  private wereUnitsReadable = true;
  private lastLogKey = "";

  public constructor(target: AcpLeaseAuditTarget, scope: AcpRecoveryScope) {
    this.target = target;
    this.scope = scope;
  }

  /** Starts the rhythm once the service recovered its leases. */
  public start(): void {
    if (this.isStopped || this.nextAt !== null) return;
    this.schedule(FIRST_CHECK_DELAY_MS);
  }

  /** Ends the rhythm with the service and waits for a running cycle. */
  public async stop(): Promise<void> {
    this.isStopped = true;
    clearTimeout(this.timer);
    this.nextAt = null;
    await this.running;
  }

  /** The last and next cycle, for the administrative resource view. */
  public summary(): AcpLeaseCheckSummary {
    const last = this.last;
    return {
      scope: this.scope,
      intervalMinutes: ACP_LEASE_CHECK_INTERVAL_MS / 60_000,
      lastAt: this.lastAt,
      nextAt: this.nextAt,
      outcome: last === null ? "pending" : outcomeOf(last),
      checked: last?.checked ?? 0,
      released: last?.released ?? 0,
      unconfirmed: last?.unconfirmed ?? 0,
      failed: last?.failed ?? 0,
    };
  }

  private schedule(delay: number): void {
    if (this.isStopped) return;
    this.nextAt = new Date(Date.now() + delay).toISOString();
    this.timer = setTimeout(() => {
      this.running = this.cycle().finally(() => {
        this.running = null;
        this.schedule(
          this.hasCycleFailed
            ? FAILED_CHECK_RETRY_MS
            : ACP_LEASE_CHECK_INTERVAL_MS,
        );
      });
    }, delay);
    this.timer.unref();
  }

  private async cycle(): Promise<void> {
    this.nextAt = null;
    this.hasLoggedCycleError = false;
    try {
      this.last = await this.checkAll();
      this.hasCycleFailed = this.last.failed > 0;
    } catch (caughtError: unknown) {
      this.logCycleError(caughtError);
      this.hasCycleFailed = true;
      this.last = {
        checked: 0,
        released: 0,
        unconfirmed: this.target.candidates().length,
        failed: 1,
        reasons: {},
      };
    }
    this.lastAt = new Date().toISOString();
    this.report(this.last);
  }

  private async checkAll(): Promise<CycleResult> {
    const candidates = this.target.candidates().slice(0, MAX_LEASES_PER_CHECK);
    const reasons: Partial<Record<AcpLeaseCheckReason, number>> = {};
    if (candidates.length === 0)
      return { checked: 0, released: 0, unconfirmed: 0, failed: 0, reasons };
    const units = await this.readUnits();
    let released = 0;
    let failed = 0;
    for (const record of candidates) {
      if (this.isStopped) break;
      const { reason, isReleased } = await this.checkOne(record, units);
      reasons[reason] = (reasons[reason] ?? 0) + 1;
      if (reason === "check_failed") failed += 1;
      if (isReleased) released += 1;
    }
    const checked = Object.values(reasons).reduce(
      (sum, count) => sum + count,
      0,
    );
    return {
      checked,
      released,
      unconfirmed: this.target.candidates().length,
      failed,
      reasons,
    };
  }

  private async checkOne(
    record: AcpResourceRecord,
    units: AcpLeaseEvidenceContext["units"],
  ): Promise<LeaseResult> {
    let reason: AcpLeaseCheckReason = "check_failed";
    try {
      reason = await withTimeout(
        classifyLease(record, {
          isUnverifiedLocal: this.target.isUnverifiedLocal(record.instanceId),
          units,
        }),
      );
      // A lease that changed meanwhile belongs to whoever changed it.
      if (isReleaseReason(reason))
        return {
          reason,
          isReleased: await this.target.release(record.instanceId),
        };
    } catch (caughtError: unknown) {
      this.logCycleError(caughtError);
      reason = "check_failed";
    }
    await this.target
      .retain(record.instanceId, reason)
      .catch((caughtError: unknown) => {
        this.logCycleError(caughtError);
      });
    return { reason, isReleased: false };
  }

  /** The service manager is read once per cycle; without it only unit evidence is missing. */
  private async readUnits(): Promise<AcpLeaseEvidenceContext["units"]> {
    try {
      const units = await withTimeout(listRunningWorkerUnits());
      this.wereUnitsReadable = true;
      return units;
    } catch (caughtError: unknown) {
      // Hosts without a user service manager would otherwise log every cycle.
      if (this.wereUnitsReadable) logCaughtError("AcpLeaseAudit", caughtError);
      this.wereUnitsReadable = false;
      return null;
    }
  }

  /** At most one error per cycle reaches the log; the summary counts the rest. */
  private logCycleError(caughtError: unknown): void {
    if (this.hasLoggedCycleError) return;
    this.hasLoggedCycleError = true;
    logCaughtError("AcpLeaseAudit", caughtError);
  }

  /** Logs a cycle only when it released, failed or found something different from the last one. */
  private report(result: CycleResult): void {
    const key = JSON.stringify(result.reasons);
    if (result.released === 0 && result.failed === 0 && key === this.lastLogKey)
      return;
    this.lastLogKey = key;
    logEvent({
      level: result.failed > 0 ? "warn" : "info",
      event: "agent.acp_lease_check.finished",
      component: "AcpLeaseAudit",
      message:
        "Periodic ACP reservation check finished; unconfirmed reservations stay reserved",
      metadata: {
        scope: this.scope,
        checked: result.checked,
        released: result.released,
        unconfirmed: result.unconfirmed,
        failed: result.failed,
        ...result.reasons,
      },
    });
  }
}
