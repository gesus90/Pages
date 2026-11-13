import { listRunningWorkerUnits } from "@/backend/agents/cli/CliWorkerUnit";
import { readJournaledWorkerUnitEnds } from "@/backend/agents/cli/CliWorkerUnitJournal";
import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";

import { classifyLease, isReleaseReason } from "./AcpLeaseEvidence";

import type { PlanSession } from "@/backend/agents/AgentPlanExecution";
import type {
  AcpLeaseCheckReason,
  AcpLeaseCleanupCategory,
  AcpLeaseCleanupEntry,
  AcpLeaseCleanupReason,
  AcpLeaseCleanupReport,
  AcpRecoveryScope,
  AcpResourceRecord,
} from "@/definition/AcpResource";
import type { AcpLeaseEvidenceContext } from "./AcpLeaseEvidence";
import type { AcpResourceStore } from "./AcpResourceStore";

/** A single lease that hangs must not hold the administrator's request. */
const LEASE_CHECK_TIMEOUT_MS = 15_000;

const CATEGORIES: readonly AcpLeaseCleanupCategory[] = [
  "releasable",
  "released",
  "kept_active",
  "kept_unproven",
  "check_failed",
];

/** Reasons that show work which still runs or is still owned by a live owner. */
const ACTIVE_REASONS: readonly AcpLeaseCleanupReason[] = [
  "process_alive",
  "unit_active",
  "owner_managed",
  "session_open",
  "start_in_progress",
  "run_paused",
  "lease_changed",
];

/** The scheduler state the cleanup reads and changes, always inside its serial writes. */
export interface AcpLeaseCleanupHost {
  readonly store: AcpResourceStore;
  readonly scope: AcpRecoveryScope;
  readonly active: Map<string, AcpResourceRecord>;
  readonly sessions: ReadonlyMap<string, PlanSession>;
  readonly pausedRuns: ReadonlySet<string>;
  isOpening(instanceId: string): boolean;
  isUnverifiedLocal(instanceId: string): boolean;
  /** Whether this process role is responsible for the lease. */
  owns(record: AcpResourceRecord): boolean;
  persist<Result>(task: () => Promise<Result>): Promise<Result>;
  /** Lets waiting requests use capacity a released lease freed. */
  wake(): void;
}

/** Host facts the cleanup reads; replaceable at the process boundary. */
export interface AcpLeaseCleanupEvidence {
  readonly units: () => Promise<ReadonlySet<string>>;
  readonly journal: typeof readJournaledWorkerUnitEnds;
  readonly classify: typeof classifyLease;
}

const HOST_EVIDENCE: AcpLeaseCleanupEvidence = {
  units: () => listRunningWorkerUnits(),
  journal: (query) => readJournaledWorkerUnitEnds(query),
  classify: classifyLease,
};

function withTimeout<Result>(task: Promise<Result>): Promise<Result> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("ACP lease cleanup check timed out"));
    }, LEASE_CHECK_TIMEOUT_MS);
    timer.unref();
  });
  return Promise.race([task, timeout]).finally(() => clearTimeout(timer));
}

/** The category of a reason that does not release the lease. */
function keptCategory(reason: AcpLeaseCleanupReason): AcpLeaseCleanupCategory {
  if (reason === "check_failed") return "check_failed";
  return ACTIVE_REASONS.includes(reason) ? "kept_active" : "kept_unproven";
}

function entryOf(
  record: AcpResourceRecord,
  category: AcpLeaseCleanupCategory,
  reason: AcpLeaseCleanupReason,
): AcpLeaseCleanupEntry {
  return {
    instanceId: record.instanceId,
    provider: record.provider,
    runId: record.runId,
    state: record.state,
    since: record.since,
    category,
    reason,
  };
}

function countEntries(
  entries: readonly AcpLeaseCleanupEntry[],
): AcpLeaseCleanupReport["counts"] {
  const counts: Record<AcpLeaseCleanupCategory, number> = {
    releasable: 0,
    released: 0,
    kept_active: 0,
    kept_unproven: 0,
    check_failed: 0,
  };
  for (const entry of entries) counts[entry.category] += 1;
  return counts;
}

/**
 * The administrator's check and confirmed cleanup of ACP reservations,
 * without a host restart (PAGE-340).
 *
 * @remarks
 * Only the service responsible for a lease checks and releases it; a lease of
 * another service is shown and kept. Live, starting and paused work is never
 * checked. The evidence is the one of the periodic check plus the journaled
 * end of a lease's only worker unit. A confirmed release classifies the
 * lease again inside the scheduler's serial writes, right before the guarded
 * delete, so a lease that changed meanwhile stays. No process is ended or
 * signalled, and nothing is deleted on age or a missing marker.
 */
export class AcpLeaseCleanup {
  private readonly host: AcpLeaseCleanupHost;
  private readonly evidence: AcpLeaseCleanupEvidence;
  private readonly runs = new SerialQueue();

  public constructor(
    host: AcpLeaseCleanupHost,
    evidence: AcpLeaseCleanupEvidence = HOST_EVIDENCE,
  ) {
    this.host = host;
    this.evidence = evidence;
  }

  /** Classifies every lease without changing any of them. */
  public preview(): Promise<AcpLeaseCleanupReport> {
    return this.runs.run(async () => {
      const records = await this.host.store.list();
      const context = await this.readContext(records);
      const entries: AcpLeaseCleanupEntry[] = [];
      for (const record of records)
        entries.push(await this.assess(record, context));
      return this.report("preview", entries);
    });
  }

  /**
   * Releases the confirmed leases whose end is still proven.
   *
   * @param confirmed - The leases the administrator confirmed from a preview;
   * a lease that became releasable since stays until it is confirmed.
   * @returns Every lease with its outcome; a repeated call finds nothing more to release.
   */
  public cleanup(
    confirmed: ReadonlySet<string>,
  ): Promise<AcpLeaseCleanupReport> {
    return this.runs.run(async () => {
      const records = await this.host.store.list();
      const context = await this.readContext(records);
      const entries: AcpLeaseCleanupEntry[] = [];
      for (const record of records) {
        const assessed = await this.assess(record, context);
        entries.push(
          assessed.category === "releasable" && confirmed.has(record.instanceId)
            ? await this.releaseChecked(record)
            : assessed,
        );
      }
      if (entries.some((entry) => entry.category === "released"))
        this.host.wake();
      return this.report("cleanup", await this.verifyStored(entries));
    });
  }

  private async readContext(
    records: readonly AcpResourceRecord[],
  ): Promise<Omit<AcpLeaseEvidenceContext, "isUnverifiedLocal">> {
    const units = await this.readUnits();
    const earliest = records.reduce<string | null>(
      (oldest, record) =>
        oldest === null || record.since < oldest ? record.since : oldest,
      null,
    );
    if (units === null || earliest === null) return { units };
    const ends = await this.readJournal({
      since: earliest,
      ...(records.length === 1 ? { instanceId: records[0]?.instanceId } : {}),
    });
    if (ends === null) return { units };
    return {
      units,
      journal: (instanceId) => Promise.resolve(ends.get(instanceId) === true),
    };
  }

  private async readUnits(): Promise<ReadonlySet<string> | null> {
    try {
      return await withTimeout(this.evidence.units());
    } catch (caughtError: unknown) {
      logCaughtError("AcpLeaseCleanup", caughtError);
      return null;
    }
  }

  /** Without a readable journal only its evidence is missing; every other check still runs. */
  private async readJournal(
    query: Parameters<typeof readJournaledWorkerUnitEnds>[0],
  ): Promise<ReadonlyMap<string, boolean> | null> {
    try {
      return await this.evidence.journal(query);
    } catch (caughtError: unknown) {
      logCaughtError("AcpLeaseCleanup", caughtError);
      return null;
    }
  }

  /** Why a lease is kept without any process check, or `null` when it may be checked. */
  private hold(record: AcpResourceRecord): AcpLeaseCleanupReason | null {
    const own = this.host.active.get(record.instanceId);
    if (!this.host.owns(record) || !own) return "other_service";
    if (this.host.isOpening(own.instanceId) || own.state === "starting")
      return "start_in_progress";
    if (
      this.host.sessions.has(own.instanceId) ||
      own.state !== "cleanup_failed"
    )
      return "session_open";
    if (own.runId !== null && this.host.pausedRuns.has(own.runId))
      return "run_paused";
    return null;
  }

  private async classify(
    record: AcpResourceRecord,
    context: Omit<AcpLeaseEvidenceContext, "isUnverifiedLocal">,
  ): Promise<AcpLeaseCheckReason> {
    try {
      return await withTimeout(
        this.evidence.classify(record, {
          ...context,
          isUnverifiedLocal: this.host.isUnverifiedLocal(record.instanceId),
        }),
      );
    } catch (caughtError: unknown) {
      logCaughtError("AcpLeaseCleanup", caughtError);
      return "check_failed";
    }
  }

  private async assess(
    record: AcpResourceRecord,
    context: Omit<AcpLeaseEvidenceContext, "isUnverifiedLocal">,
  ): Promise<AcpLeaseCleanupEntry> {
    const held = this.hold(record);
    const current = this.host.active.get(record.instanceId) ?? record;
    if (held !== null) return entryOf(current, keptCategory(held), held);
    const reason = await this.classify(current, context);
    return entryOf(
      current,
      isReleaseReason(reason) ? "releasable" : keptCategory(reason),
      reason,
    );
  }

  /**
   * Checks a confirmed lease again inside the serial writes and releases it
   * only while it is still idle, unconfirmed and proven ended.
   */
  private async releaseChecked(
    record: AcpResourceRecord,
  ): Promise<AcpLeaseCleanupEntry> {
    return this.host.persist(async () => {
      const current = this.host.active.get(record.instanceId);
      if (!current || this.hold(current) !== null)
        return entryOf(current ?? record, "kept_active", "lease_changed");
      // Fresh host facts: a unit may have started since the preview.
      const context = await this.readContext([current]);
      const reason = await this.classify(current, context);
      if (!isReleaseReason(reason)) {
        await this.recordKept(current, reason);
        return entryOf(current, keptCategory(reason), reason);
      }
      const { store } = this.host;
      const result = store.releaseUncertain
        ? await store.releaseUncertain(current.instanceId)
        : await store
            .remove(current.instanceId)
            .then(() => "released" as const);
      if (result === "changed")
        return entryOf(current, "kept_active", "lease_changed");
      this.host.active.delete(current.instanceId);
      return entryOf(current, "released", reason);
    });
  }

  /** Stores why a confirmed lease stays, like the periodic check does. */
  private async recordKept(
    record: AcpResourceRecord,
    reason: AcpLeaseCheckReason,
  ): Promise<void> {
    const check = { reason, at: new Date().toISOString() };
    try {
      await this.host.store.recordCheck?.(record.instanceId, check);
      this.host.active.set(record.instanceId, { ...record, check });
    } catch (caughtError: unknown) {
      logCaughtError("AcpLeaseCleanup", caughtError);
    }
  }

  /** Reports a release only when the stored state no longer holds the lease. */
  private async verifyStored(
    entries: readonly AcpLeaseCleanupEntry[],
  ): Promise<readonly AcpLeaseCleanupEntry[]> {
    if (!entries.some((entry) => entry.category === "released")) return entries;
    let stored: ReadonlySet<string> | null = null;
    try {
      stored = new Set(
        (await this.host.store.list()).map((record) => record.instanceId),
      );
    } catch (caughtError: unknown) {
      logCaughtError("AcpLeaseCleanup", caughtError);
    }
    return entries.map((entry) => {
      if (entry.category !== "released") return entry;
      if (stored === null)
        return { ...entry, category: "check_failed", reason: "check_failed" };
      return stored.has(entry.instanceId)
        ? { ...entry, category: "kept_active", reason: "lease_changed" }
        : entry;
    });
  }

  private report(
    mode: AcpLeaseCleanupReport["mode"],
    entries: readonly AcpLeaseCleanupEntry[],
  ): AcpLeaseCleanupReport {
    const counts = countEntries(entries);
    logEvent({
      level: counts.check_failed > 0 ? "warn" : "info",
      event: `agent.acp_lease_cleanup.${mode}`,
      component: "AcpLeaseCleanup",
      message:
        mode === "preview"
          ? "Administrative ACP reservation check finished without changes"
          : "Administrative ACP reservation cleanup finished; unproven reservations stay reserved",
      metadata: {
        source: this.host.scope,
        count: entries.length,
        reservationsReleased: counts.released,
        reservationsKept:
          counts.kept_active + counts.kept_unproven + counts.releasable,
        failed: counts.check_failed,
      },
    });
    return {
      mode,
      scope: this.host.scope,
      at: new Date().toISOString(),
      counts,
      entries: [...entries].sort(
        (left, right) =>
          CATEGORIES.indexOf(left.category) -
            CATEGORIES.indexOf(right.category) ||
          left.since.localeCompare(right.since),
      ),
    };
  }
}
