import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import {
  endTaggedProcesses,
  readScopeSince,
} from "@/backend/agents/cli/CliProcessScan";
import { readAcpResourceOptions } from "@/backend/config/AcpResourceConfig";
import { AcpCleanupUnconfirmedError } from "@/backend/error/AcpCleanupUnconfirmedError";
import { settleOwnedNamespace } from "@/backend/agents/cli/CliOwnedNamespace";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { logCaughtError } from "@/backend/logging/Logger";
import { isAcpSessionLimit, MAX_ACP_SESSIONS } from "@/definition/AcpResource";

import { AgentToolPreflightError } from "./tools/AgentToolReadinessError";
import { readAcpAvailableMemory } from "./resources/AcpMemory";
import { ScheduledAcpSession } from "./resources/ScheduledAcpSession";

import type {
  PlanSession,
  PlanSessionObserver,
} from "@/backend/agents/AgentPlanExecution";
import type {
  AcpResourceOptions,
  AcpResourceLimitSource,
  AcpResourceOwner,
  AcpResourceRecord,
  AcpResourceSnapshot,
  AcpResourceState,
  AcpNamespaceOwner,
  AcpWaitReason,
} from "@/definition/AcpResource";
import type { AcpResourceStore } from "./resources/AcpResourceStore";

interface SchedulerDependencies {
  readonly store: AcpResourceStore;
  readonly options?: Partial<AcpResourceOptions>;
  readonly limitSource?: AcpResourceLimitSource;
  readonly memory?: () => Promise<number | null>;
  /** Ends the processes of a lease; `startedAt` is `null` when its start is unknown. */
  readonly cleanup?: (
    instanceId: string,
    startedAt: string | null,
  ) => Promise<{ readonly remaining: number }>;
}

/** A lease records its start before its runner exists, which bounds the start of its processes. */
async function endLeaseProcesses(
  instanceId: string,
  startedAt: string | null,
): Promise<{ readonly remaining: number }> {
  const scope = startedAt === null ? null : await readScopeSince(startedAt);
  return endTaggedProcesses(instanceId, scope);
}

/** Uncertain leases are checked again at most this often while they block admission. */
const LEASE_RECHECK_MS = 60_000;

interface WaitingRequest {
  readonly owner: AcpResourceOwner;
  readonly since: string;
  readonly signal: AbortSignal;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
  readonly abort: () => void;
}

/** Shared FIFO admission for ACP processes, independent of DAG scheduling and provider. */
export class AcpResourceScheduler {
  private readonly store: AcpResourceStore;
  private options: AcpResourceOptions;
  private limitSource: AcpResourceLimitSource;
  private readonly memory: () => Promise<number | null>;
  private readonly cleanup: NonNullable<SchedulerDependencies["cleanup"]>;
  private readonly writes = new SerialQueue();
  private readonly active = new Map<string, AcpResourceRecord>();
  private readonly sessions = new Map<string, PlanSession>();
  private readonly waiting: WaitingRequest[] = [];
  private readonly pausedRuns = new Set<string>();
  private readonly shutdownController = new AbortController();
  private readonly opening = new Set<Promise<PlanSession>>();
  private availableMemory: number | null = null;
  private problem: AcpResourceSnapshot["problem"] = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private isReady = false;
  private isClosing = false;
  private isPumping = false;
  private hasPendingWake = false;
  private lastLeaseCheck = 0;

  public constructor(dependencies: SchedulerDependencies) {
    this.store = dependencies.store;
    this.options = readAcpResourceOptions(dependencies.options, {});
    this.limitSource =
      dependencies.limitSource ??
      (dependencies.options?.maxConcurrentAcpSessions === undefined
        ? "default"
        : "config");
    this.memory = dependencies.memory ?? readAcpAvailableMemory;
    this.cleanup = dependencies.cleanup ?? endLeaseProcesses;
  }

  /**
   * Recovers durable leases before admission; never resumes or retries an interrupted job.
   *
   * @param legacyOwners - Interrupted sessions from before the lease journal.
   * @param retained - Sessions whose cleanup an earlier startup step could not
   * confirm; their leases keep capacity until a later start confirms it.
   */
  public async recover(
    legacyOwners: readonly AcpResourceOwner[] = [],
    retained: ReadonlySet<string> = new Set(),
  ): Promise<void> {
    if (this.isReady || this.isClosing)
      throw new Error("ACP scheduler already initialized");
    const previous = await this.store.list();
    for (const record of previous) this.active.set(record.instanceId, record);
    // An adopted lease is dated now, after its processes started, so its start rules nothing out.
    const adopted = new Set<string>();
    for (const owner of legacyOwners) {
      if (this.active.has(owner.instanceId)) continue;
      const record: AcpResourceRecord = {
        ...owner,
        state: "starting",
        since: new Date().toISOString(),
      };
      this.active.set(record.instanceId, record);
      adopted.add(record.instanceId);
      await this.writes.run(() => this.store.save(record));
    }
    for (const record of this.active.values()) {
      if (retained.has(record.instanceId)) {
        await this.transition(record.instanceId, "cleanup_failed");
        continue;
      }
      try {
        const cleanup = await this.cleanupRecord(
          record,
          adopted.has(record.instanceId) ? null : record.since,
        );
        await this.finish(record.instanceId, cleanup.remaining === 0);
      } catch (caughtError: unknown) {
        logCaughtError("AcpResourceScheduler", caughtError);

        await this.transition(record.instanceId, "cleanup_failed");
      }
    }
    this.isReady = true;
    this.wake();
  }

  /** Waits without a native process; the durable starting lease precedes the callback. */
  public open(
    owner: AcpResourceOwner,
    signal: AbortSignal,
    start: (signal: AbortSignal) => Promise<PlanSession>,
    observer?: PlanSessionObserver,
  ): Promise<PlanSession> {
    const pending = this.openSession(owner, signal, start, observer);
    this.opening.add(pending);
    void pending.then(
      () => this.opening.delete(pending),
      () => this.opening.delete(pending),
    );
    return pending;
  }

  /** Persists an owned namespace supervisor before its first ACP request. */
  public async registerNamespace(
    instanceId: string,
    namespace: AcpNamespaceOwner,
  ): Promise<void> {
    await this.writes.run(async () => {
      const current = this.active.get(instanceId);
      if (!current || current.state !== "starting")
        throw new Error("ACP reservation is not starting");
      const record = { ...current, namespace };
      await this.store.save(record);
      this.active.set(instanceId, record);
    });
  }

  /** Suspends queued requests of a paused run; existing sessions continue to own capacity. */
  public pauseRun(runId: string): void {
    this.pausedRuns.add(runId);
  }

  /** Makes suspended requests eligible again in their original FIFO position. */
  public resumeRun(runId: string): void {
    this.pausedRuns.delete(runId);
    this.wake();
  }

  /** Refreshes RAM for monitoring even while capacity is full or the queue is empty. */
  public async inspect(): Promise<AcpResourceSnapshot> {
    await this.refreshMemory();
    return this.snapshot();
  }

  /** Changes admission immediately and wakes FIFO waiters without interrupting occupied leases. */
  public updateMaxConcurrentAcpSessions(limit: number): AcpResourceSnapshot {
    if (!isAcpSessionLimit(limit))
      throw new Error("Invalid ACP resource setting: maxConcurrentAcpSessions");
    if (this.limitSource === "environment")
      throw new Error("ACP concurrency is controlled by the environment");
    this.options = { ...this.options, maxConcurrentAcpSessions: limit };
    this.limitSource = "config";
    this.wake();
    return this.snapshot();
  }

  /** Returns secret-free global diagnostics; callers must require administrative access. */
  public snapshot(): AcpResourceSnapshot {
    return {
      options: this.options,
      limitSource: this.limitSource,
      availableMemory: this.availableMemory,
      problem: this.problem,
      active: [...this.active.values()].map((record) => ({
        ...record,
        isPaused: record.runId !== null && this.pausedRuns.has(record.runId),
      })),
      waiting: this.waiting.map((request) => ({
        ...request.owner,
        since: request.since,
        reason: this.waitReason(request),
      })),
    };
  }

  /**
   * Checks uncertain leases again and releases each one whose processes are proven gone.
   *
   * @param runId - Only the leases of this plan run; `undefined` checks every uncertain lease.
   * @returns How many leases stay uncertain.
   *
   * @remarks
   * A registered namespace supervisor is checked against its boot and start
   * identity; legacy leases without containment evidence remain uncertain.
   */
  public async reconcile(runId?: string): Promise<number> {
    const uncertain = [...this.active.values()].filter(
      (record) =>
        record.state === "cleanup_failed" &&
        !this.sessions.has(record.instanceId) &&
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
      if (!(await this.finish(record.instanceId, isConfirmed))) remaining += 1;
    }
    return remaining;
  }

  /** Cancels all waiters and drains sessions; uncertain leases survive server exit. */
  public async shutdown(): Promise<void> {
    this.isClosing = true;
    clearTimeout(this.timer);
    this.shutdownController.abort();
    await Promise.allSettled([...this.opening]);
    await Promise.allSettled(
      [...this.sessions.values()].map((session) => session.close()),
    );
  }

  private async cleanupRecord(
    record: AcpResourceRecord,
    startedAt: string | null,
  ): Promise<{ readonly remaining: number }> {
    if (record.namespace)
      return {
        remaining: (await settleOwnedNamespace(
          record.namespace,
          record.instanceId,
        ))
          ? 0
          : 1,
      };
    return this.cleanup(record.instanceId, startedAt);
  }

  private async openSession(
    owner: AcpResourceOwner,
    signal: AbortSignal,
    start: (signal: AbortSignal) => Promise<PlanSession>,
    observer?: PlanSessionObserver,
  ): Promise<PlanSession> {
    const combined = AbortSignal.any([signal, this.shutdownController.signal]);
    await this.acquire(owner, combined);
    let native: PlanSession | null = null;
    let hasAttemptedStart = false;
    try {
      if (combined.aborted || this.isClosing)
        throw new AgentPlanCancelledError();
      hasAttemptedStart = true;
      native = await start(combined);
      await this.transition(owner.instanceId, "running");
      const session = new ScheduledAcpSession(
        native,
        {
          idleTimeout: this.options.acpIdleTimeout,
          transition: (state, stepId) =>
            this.transition(owner.instanceId, state, stepId),
          finish: (isConfirmed) => this.finish(owner.instanceId, isConfirmed),
        },
        observer,
      );
      this.sessions.set(owner.instanceId, session);
      return session;
    } catch (error: unknown) {
      logCaughtError("AcpResourceScheduler", error);

      let isConfirmed =
        !hasAttemptedStart || error instanceof AgentToolPreflightError;
      const startedAt = this.active.get(owner.instanceId)?.since ?? null;
      try {
        if (native) isConfirmed = (await native.close()).isConfirmed;
        else if (
          hasAttemptedStart &&
          !isConfirmed &&
          !(error instanceof AcpCleanupUnconfirmedError)
        )
          isConfirmed =
            (
              await this.cleanupRecord(
                this.active.get(owner.instanceId) ?? {
                  ...owner,
                  state: "starting",
                  since: startedAt ?? "",
                },
                startedAt,
              )
            ).remaining === 0;
      } catch (caughtError: unknown) {
        logCaughtError("AcpResourceScheduler", caughtError);

        // Any unknown closeout keeps the reservation.
      }
      await this.finish(owner.instanceId, isConfirmed);
      throw error;
    }
  }

  private acquire(owner: AcpResourceOwner, signal: AbortSignal): Promise<void> {
    if (signal.aborted || this.isClosing)
      return Promise.reject(new AgentPlanCancelledError());
    if (
      this.active.has(owner.instanceId) ||
      this.waiting.some(
        (request) => request.owner.instanceId === owner.instanceId,
      )
    )
      return Promise.reject(new Error("ACP instance already reserved"));
    return new Promise((resolve, reject) => {
      const request: WaitingRequest = {
        owner,
        signal,
        since: new Date().toISOString(),
        resolve,
        reject,
        abort: () => {
          const index = this.waiting.indexOf(request);
          if (index < 0) return;
          this.waiting.splice(index, 1);
          signal.removeEventListener("abort", request.abort);
          reject(new AgentPlanCancelledError());
          this.wake();
        },
      };
      this.waiting.push(request);
      signal.addEventListener("abort", request.abort, { once: true });
      if (signal.aborted) request.abort();
      this.wake();
    });
  }

  private wake(): void {
    if (this.isClosing) return;
    if (this.isPumping) {
      this.hasPendingWake = true;
      return;
    }
    this.hasPendingWake = false;
    clearTimeout(this.timer);
    this.isPumping = true;
    void this.pump()
      .catch((caughtError: unknown) => {
        logCaughtError("AcpResourceScheduler", caughtError);

        this.problem = "storage";
      })
      .finally(() => {
        this.isPumping = false;
        if (this.waiting.length === 0 || this.isClosing) return;
        if (this.hasPendingWake) {
          this.wake();
          return;
        }
        this.timer = setTimeout(() => this.wake(), 1000);
        this.timer.unref();
      });
  }

  private async pump(): Promise<void> {
    await this.recheckBlockingLeases();
    while (this.canAdmit()) {
      const request = this.waiting.find((entry) => !this.isPaused(entry));
      if (!request) return;
      await this.refreshMemory();
      // A live reduction or shutdown may have happened during the memory probe.
      if (!this.canAdmit()) return;
      if (
        this.options.memoryAwareScheduling &&
        (this.availableMemory === null ||
          this.availableMemory < this.options.minimumAvailableMemory)
      )
        return;
      if (
        request.signal.aborted ||
        !this.waiting.includes(request) ||
        this.isPaused(request)
      )
        continue;
      this.waiting.splice(this.waiting.indexOf(request), 1);
      request.signal.removeEventListener("abort", request.abort);
      const record: AcpResourceRecord = {
        ...request.owner,
        state: "starting",
        since: request.since,
      };
      this.active.set(record.instanceId, record);
      try {
        await this.writes.run(() => this.store.save(record));
        request.resolve();
      } catch (caughtError: unknown) {
        logCaughtError("AcpResourceScheduler", caughtError);

        this.problem = "storage";
        this.active.set(record.instanceId, {
          ...record,
          state: "cleanup_failed",
        });
        request.reject(new Error("ACP reservation could not be persisted"));
      }
    }
  }

  private async transition(
    instanceId: string,
    state: AcpResourceState,
    stepId?: string,
  ): Promise<void> {
    await this.writes.run(async () => {
      const current = this.active.get(instanceId);
      if (!current) return;
      const record = {
        ...current,
        state,
        ...(stepId === undefined ? {} : { stepId }),
      };
      this.active.set(instanceId, record);
      try {
        await this.store.save(record);
      } catch (caughtError: unknown) {
        logCaughtError("AcpResourceScheduler", caughtError);

        this.problem = "storage";
        this.active.set(instanceId, { ...record, state: "cleanup_failed" });
      }
    });
  }

  private async finish(
    instanceId: string,
    isConfirmed: boolean,
  ): Promise<boolean> {
    const released = await this.writes.run(async () => {
      const current = this.active.get(instanceId);
      if (!current) return true;
      this.sessions.delete(instanceId);
      if (isConfirmed) {
        try {
          await this.store.remove(instanceId);
          this.active.delete(instanceId);
          return true;
        } catch (caughtError: unknown) {
          logCaughtError("AcpResourceScheduler", caughtError);

          this.problem = "storage";
        }
      }
      const record: AcpResourceRecord = { ...current, state: "cleanup_failed" };
      this.active.set(instanceId, record);
      try {
        await this.store.save(record);
      } catch (caughtError: unknown) {
        logCaughtError("AcpResourceScheduler", caughtError);

        this.problem = "storage";
      }
      return false;
    });
    this.wake();
    return released;
  }

  /** A waiting request blocked only by uncertain leases gets them checked again, bounded in time. */
  private async recheckBlockingLeases(): Promise<void> {
    if (
      !this.isReady ||
      this.isClosing ||
      this.waiting.length === 0 ||
      this.active.size < this.admissionCap() ||
      Date.now() - this.lastLeaseCheck < LEASE_RECHECK_MS ||
      ![...this.active.values()].some(
        (record) => record.state === "cleanup_failed",
      )
    )
      return;
    this.lastLeaseCheck = Date.now();
    await this.reconcile();
  }

  private async refreshMemory(): Promise<void> {
    try {
      const available = await this.memory();
      this.availableMemory =
        available !== null && Number.isFinite(available) && available >= 0
          ? available
          : null;
    } catch (caughtError: unknown) {
      logCaughtError("AcpResourceScheduler", caughtError);

      this.availableMemory = null;
    }
  }

  private isPaused(request: WaitingRequest): boolean {
    return (
      request.owner.runId !== null && this.pausedRuns.has(request.owner.runId)
    );
  }

  private admissionCap(): number {
    return this.options.maxConcurrentAcpSessions === 0
      ? MAX_ACP_SESSIONS
      : this.options.maxConcurrentAcpSessions;
  }

  private canAdmit(): boolean {
    return (
      this.isReady &&
      !this.isClosing &&
      !this.problem &&
      this.active.size < this.admissionCap()
    );
  }

  private waitReason(request: WaitingRequest): AcpWaitReason {
    if (this.isPaused(request)) return "paused";
    if (!this.isReady) return "recovery";
    if (this.problem) return "scheduler_error";
    if (this.active.size >= this.admissionCap()) return "capacity";
    if (this.options.memoryAwareScheduling && this.availableMemory === null)
      return "memory_unknown";
    if (
      this.options.memoryAwareScheduling &&
      this.availableMemory !== null &&
      this.availableMemory < this.options.minimumAvailableMemory
    )
      return "memory";
    return "capacity";
  }
}
