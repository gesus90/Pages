import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { readAcpResourceOptions } from "@/backend/config/AcpResourceConfig";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { logCaughtError } from "@/backend/logging/Logger";
import { isAcpSessionLimit, MAX_ACP_SESSIONS } from "@/definition/AcpResource";

import { forceReleaseAcpRun } from "./resources/AcpRunRelease";
import {
  cleanupAcpLease,
  reconcileAcpLeases,
  recoverAcpLease,
} from "./resources/AcpLeaseRecovery";
import { AcpWaitDiagnostics } from "./resources/AcpWaitDiagnostics";
import { AcpLeaseAdmission } from "./resources/AcpLeaseAdmission";
import { AcpLeaseChecks } from "./resources/AcpLeaseChecks";
import {
  confirmFailedStart,
  endLeaseProcesses,
} from "./resources/AcpLeaseProcesses";
import {
  acpMemoryWaitReason,
  readAcpAvailableMemory,
  readScheduledAcpMemory,
} from "./resources/AcpMemory";
import { ScheduledAcpSession } from "./resources/ScheduledAcpSession";
import { enqueueAcpRequest } from "./resources/AcpAdmissionRequest";

import type { SchedulerDependencies } from "./resources/AcpSchedulerDependencies";
import type { AcpLeaseCleanup } from "./resources/AcpLeaseCleanup";
import type {
  AcpOpenRequest,
  WaitingRequest,
} from "./resources/AcpAdmissionRequest";
import type {
  PlanSession,
  PlanSessionObserver,
} from "@/backend/agents/AgentPlanExecution";
import type {
  AcpResourceDiagnostics,
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

/** Uncertain leases are checked again at most this often while they block admission. */
const LEASE_RECHECK_MS = 60_000;

/** Shared FIFO admission for ACP processes, independent of DAG scheduling and provider. */
export class AcpResourceScheduler {
  private readonly store: AcpResourceStore;
  private readonly admission: AcpLeaseAdmission;
  private optionsRevision = 0;
  private options: AcpResourceOptions;
  private limitSource: AcpResourceLimitSource;
  private readonly memory: () => Promise<number | null>;
  private readonly cleanup: NonNullable<SchedulerDependencies["cleanup"]>;
  private readonly settleUnits: SchedulerDependencies["settleUnits"];
  private readonly writes = new SerialQueue();
  private readonly active = new Map<string, AcpResourceRecord>();
  private readonly sessions = new Map<string, PlanSession>();
  private readonly waiting: WaitingRequest[] = [];
  private readonly waitDiagnostics = new AcpWaitDiagnostics();
  private waitObserver:
    ((waiting: AcpResourceSnapshot["waiting"]) => Promise<void>) | null = null;
  private readonly pausedRuns = new Set<string>();
  private readonly shutdownController = new AbortController();
  private readonly opening = new Set<Promise<PlanSession>>();
  private readonly checks: AcpLeaseChecks;
  /** The administrator's check and confirmed cleanup of the leases this service owns (PAGE-340). */
  public readonly leaseCleanup: AcpLeaseCleanup;
  private unverifiedLocal: Set<string> = new Set();
  private availableMemory: number | null = null;
  private problem: AcpResourceSnapshot["problem"] = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private reconcileTimer: ReturnType<typeof setTimeout> | undefined;
  private reconcileTask: Promise<void> | null = null;
  private isReady = false;
  private isClosing = false;
  private isPumping = false;
  private hasPendingWake = false;
  private lastLeaseCheck = 0;
  private reclaimIdle: (() => boolean) | null = null;

  public constructor(dependencies: SchedulerDependencies) {
    this.store = dependencies.store;
    this.admission = new AcpLeaseAdmission(
      dependencies.store,
      dependencies.recoveryScope ?? "all",
      dependencies.readOptions,
    );
    this.options = readAcpResourceOptions(dependencies.options, {});
    this.limitSource =
      dependencies.limitSource ??
      (dependencies.options?.maxConcurrentAcpSessions === undefined
        ? "default"
        : "config");
    this.memory = dependencies.memory ?? readAcpAvailableMemory;
    this.cleanup = dependencies.cleanup ?? endLeaseProcesses;
    this.settleUnits = dependencies.settleUnits;
    this.checks = new AcpLeaseChecks({
      store: this.store,
      scope: this.admission.recoveryScope(),
      active: this.active,
      sessions: this.sessions,
      pausedRuns: this.pausedRuns,
      unverifiedLocal: () => this.unverifiedLocal,
      persist: (task) => this.persist(task),
      wake: () => this.wake(),
      owns: (record) => this.admission.owns(record),
    });
    this.leaseCleanup = this.checks.cleanup;
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
    preserved: ReadonlySet<string> = new Set(),
    unverified: ReadonlySet<string> = new Set(),
  ): Promise<void> {
    if (this.isReady || this.isClosing)
      throw new Error("ACP scheduler already initialized");
    const previous = await this.admission.recoverable();
    this.unverifiedLocal = new Set(unverified);
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
      await this.persist(() => this.store.save(record));
    }
    for (const record of this.active.values())
      await recoverAcpLease(
        record,
        { preserved, retained, adopted },
        {
          transition: (id, state) => this.transition(id, state),
          cleanup: (lease, since) => this.cleanupLease(lease, since),
          finish: (id, confirmed) => this.finish(id, confirmed),
        },
      );
    this.isReady = true;
    this.wake();
    // The periodic check runs with the service, also without queue or open settings page.
    this.checks.start();
    this.scheduleReconcile(0);
  }

  /** Waits without a native process; the durable starting lease precedes the callback. */
  public open(
    owner: AcpResourceOwner,
    signal: AbortSignal,
    start: AcpOpenRequest["start"],
    observer?: PlanSessionObserver,
  ): Promise<PlanSession> {
    return this.openWithin({ owner, signal, start, observer });
  }

  /**
   * Opens a session like {@link open}; with a deadline the request leaves the
   * queue without a place when none became free in time.
   *
   * @throws {AcpAdmissionTimeoutError} After the deadline.
   */
  public openWithin(request: AcpOpenRequest): Promise<PlanSession> {
    const pending = this.openSession(request);
    this.opening.add(pending);
    const settled = this.checks.opening(request.owner.instanceId);
    const settle = (): void => {
      this.opening.delete(pending);
      settled();
    };
    void pending.then(settle, settle);
    return pending;
  }

  /** Persists an owned namespace supervisor before its first ACP request. */
  public async registerNamespace(
    instanceId: string,
    namespace: AcpNamespaceOwner,
  ): Promise<void> {
    await this.persist(async () => {
      const current = this.active.get(instanceId);
      if (
        current?.namespace &&
        JSON.stringify(current.namespace) === JSON.stringify(namespace)
      )
        return;
      if (
        !current ||
        current.state === "closing" ||
        current.state === "cleanup_failed"
      )
        throw new Error("ACP reservation is not starting");
      if (
        current.namespace &&
        JSON.stringify(current.namespace) !== JSON.stringify(namespace)
      )
        throw new Error("ACP namespace identity changed");
      const record = { ...current, namespace, lifecycle: "process" as const };
      await this.store.save(record);
      this.active.set(instanceId, record);
    });
  }

  /** Suspends queued requests of a paused run; existing sessions continue to own capacity. */
  public async adoptSession(
    instanceId: string,
    session: PlanSession,
    observer: PlanSessionObserver,
  ): Promise<PlanSession> {
    if (
      !this.active.has(instanceId) ||
      this.unverifiedLocal.has(instanceId) ||
      session.isDurable !== true
    )
      throw new Error("ACP durable lease cannot be adopted");
    const wrapped = this.wrap(instanceId, session, observer);
    this.sessions.set(instanceId, wrapped);
    return wrapped;
  }

  /** Releases a recovered lease only after its trusted local owner proved native closeout. */
  public async completeAdopted(
    instanceId: string,
    closed: { readonly isConfirmed: boolean },
  ): Promise<void> {
    if (this.unverifiedLocal.has(instanceId))
      throw new Error("Unverified local lease");
    if (this.active.has(instanceId))
      await this.finish(instanceId, closed.isConfirmed);
  }

  /**
   * Installs what ends the longest idle chat session when a start waits at
   * the instance limit (PAGE-335).
   *
   * @param reclaim - Ends one idle session and returns whether it found one.
   */
  public setIdleReclaimer(reclaim: () => boolean): void {
    this.reclaimIdle = reclaim;
  }

  /** Installs the engine's serialized persistence of current admission reasons. */
  public setWaitObserver(
    observer: (waiting: AcpResourceSnapshot["waiting"]) => Promise<void>,
  ): void {
    this.waitObserver = observer;
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
  public async inspect(): Promise<Omit<AcpResourceDiagnostics, "leftovers">> {
    await this.refreshOptions();
    this.availableMemory = await readScheduledAcpMemory(this.memory);
    return {
      ...this.snapshot(),
      ...(await this.admission.records((record) =>
        this.checks.describe(record),
      )),
    };
  }

  /** Changes admission immediately and wakes FIFO waiters without interrupting occupied leases. */
  public updateMaxConcurrentAcpSessions(limit: number): AcpResourceSnapshot {
    if (!isAcpSessionLimit(limit))
      throw new Error("Invalid ACP resource setting: maxConcurrentAcpSessions");
    if (this.limitSource === "environment")
      throw new Error("ACP concurrency is controlled by the environment");
    this.options = { ...this.options, maxConcurrentAcpSessions: limit };
    this.optionsRevision += 1;
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
      check: this.checks.summary(),
      active: [...this.active.values()].map((record) =>
        this.checks.describe(record),
      ),
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
   * With a run, the cleanup of its leases is attempted again first, and a
   * lease is released only when it succeeded. A registered namespace
   * supervisor is then checked against its boot and start identity; legacy
   * leases without containment evidence remain uncertain.
   */
  public async reconcile(runId?: string): Promise<number> {
    // An ended run's own leases first get their cleanup attempted again; the periodic check judges by evidence only.
    if (runId !== undefined)
      await reconcileAcpLeases(
        [...this.active.values()].filter(
          (record) =>
            record.state === "cleanup_failed" &&
            !this.sessions.has(record.instanceId) &&
            record.runId === runId,
        ),
        {
          cleanup: (record) => this.cleanupLease(record, record.since),
          finish: (id, confirmed) => this.finish(id, confirmed),
        },
      );
    return this.checks.reconcile(runId);
  }

  /** Frees only an explicitly superseded run's capacity after its process cleanup was attempted. */
  public async forceReleaseRun(runId: string): Promise<boolean> {
    return forceReleaseAcpRun(runId, {
      active: this.active,
      waiting: this.waiting,
      pausedRuns: this.pausedRuns,
      finish: (id, confirmed) => this.finish(id, confirmed),
    });
  }

  /** Cancels all waiters and drains sessions; uncertain leases survive server exit. */
  public async shutdown(): Promise<void> {
    this.isClosing = true;
    clearTimeout(this.timer);
    clearTimeout(this.reconcileTimer);
    await this.reconcileTask;
    this.shutdownController.abort();
    await this.checks.stop();
    await Promise.allSettled([...this.opening]);
    await Promise.allSettled(
      [...this.sessions.values()]
        .filter((session) => !session.isDetached)
        .map((session) => session.close()),
    );
  }

  private scheduleReconcile(delay: number): void {
    if (this.isClosing) return;
    this.reconcileTimer = setTimeout(() => {
      this.reconcileTask = this.reconcile()
        .then(() => undefined)
        .catch((error: unknown) => {
          logCaughtError("AcpResourceScheduler", error);
        })
        .finally(() => {
          this.reconcileTask = null;
          this.scheduleReconcile(5 * 60_000);
        });
    }, delay);
    this.reconcileTimer.unref();
  }

  private cleanupLease(
    record: AcpResourceRecord,
    since: string | null,
  ): Promise<{ readonly remaining: number }> {
    return cleanupAcpLease(record, since, {
      unverified: this.unverifiedLocal,
      cleanup: this.cleanup,
      settleUnits: this.settleUnits,
    });
  }

  private async openSession(request: AcpOpenRequest): Promise<PlanSession> {
    const { owner, start, observer } = request;
    const combined = AbortSignal.any([
      request.signal,
      this.shutdownController.signal,
    ]);
    await this.acquire(owner, combined, request.deadlineMs);
    let native: PlanSession | null = null;
    let hasAttemptedStart = false;
    try {
      if (combined.aborted || this.isClosing)
        throw new AgentPlanCancelledError();
      hasAttemptedStart = true;
      native = await start(combined, this.checks.lifecycle(owner.instanceId));
      await this.transition(owner.instanceId, "running");
      const session = this.wrap(owner.instanceId, native, observer);
      this.sessions.set(owner.instanceId, session);
      return session;
    } catch (error: unknown) {
      logCaughtError("AcpResourceScheduler", error);

      const isConfirmed = await confirmFailedStart({
        error,
        native,
        isProven:
          !hasAttemptedStart ||
          this.checks.isStartEnded(owner.instanceId, native),
        close: () => {
          const current = this.active.get(owner.instanceId);
          const fallback = { ...owner, state: "starting" as const, since: "" };
          return this.cleanupLease(current ?? fallback, current?.since ?? null);
        },
      });
      await this.finish(owner.instanceId, isConfirmed);
      throw error;
    }
  }

  private acquire(
    owner: AcpResourceOwner,
    signal: AbortSignal,
    deadlineMs?: number,
  ): Promise<void> {
    if (signal.aborted || this.isClosing)
      return Promise.reject(new AgentPlanCancelledError());
    if (
      this.active.has(owner.instanceId) ||
      this.waiting.some(
        (request) => request.owner.instanceId === owner.instanceId,
      )
    )
      return Promise.reject(new Error("ACP instance already reserved"));
    return enqueueAcpRequest(
      { waiting: this.waiting, wake: () => this.wake() },
      owner,
      signal,
      deadlineMs,
    );
  }

  private wrap(
    instanceId: string,
    session: PlanSession,
    observer: PlanSessionObserver | undefined,
  ): ScheduledAcpSession {
    return new ScheduledAcpSession(
      session,
      {
        transition: (state, stepId) =>
          this.transition(instanceId, state, stepId),
        finish: (isConfirmed) => this.finish(instanceId, isConfirmed),
        settle: (error) => this.settleSessionLease(instanceId, error),
      },
      observer,
    );
  }

  /** Reconciles a failed close using the recorded lease identity and worker units. */
  private async settleSessionLease(
    instanceId: string,
    error?: unknown,
  ): Promise<boolean> {
    const record = this.active.get(instanceId);
    if (!record) return true;
    if (
      record.runId !== null &&
      (!(error instanceof AgentError) ||
        (error.code !== "plan_local_control_failed" &&
          error.code !== "plan_local_owner_unverified"))
    )
      return false;
    return (await this.cleanupLease(record, record.since)).remaining === 0;
  }

  /**
   * Stores a lease in the order of the scheduler, outside any request.
   *
   * @remarks
   * Leases belong to all sessions, and a refused write blocks admission until
   * the next start, so a client that left must not be able to cause one (PAGE-199).
   */
  private persist<Result>(task: () => Promise<Result>): Promise<Result> {
    return withBackgroundDatabaseWork("acp_resources", () =>
      this.writes.run(task),
    );
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
    // Whoever wakes it, the scheduler serves the sessions of everyone (PAGE-199).
    void withBackgroundDatabaseWork("acp_resources", () => this.pump())
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

  private async refreshOptions(): Promise<void> {
    const revision = this.optionsRevision;
    const options = await this.admission.options(this.options);
    if (revision === this.optionsRevision) this.options = options;
  }

  private async pump(): Promise<void> {
    try {
      await this.admitWaiting();
    } finally {
      this.waitDiagnostics.report(this.waiting, (request) =>
        this.waitReason(request),
      );
      await this.waitObserver?.(this.snapshot().waiting);
    }
  }

  private async admitWaiting(): Promise<void> {
    await this.refreshOptions();
    await this.recheckBlockingLeases();
    // An idle chat session gives its place to a waiting start; its closeout wakes the queue.
    if (this.isAtCapacity()) this.reclaimIdle?.();
    while (this.canAdmit()) {
      const request = this.waiting.find((entry) => !this.isPaused(entry));
      if (!request) return;
      this.availableMemory = await readScheduledAcpMemory(this.memory);
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
        lifecycle: "reserved",
      };
      this.active.set(record.instanceId, record);
      try {
        const reserved = await this.persist(() =>
          this.admission.reserve(record, this.admissionCap()),
        );
        if (!reserved) {
          this.deferRequest(request);
          return;
        }
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

  private deferRequest(request: WaitingRequest): void {
    this.active.delete(request.owner.instanceId);
    if (request.signal.aborted) {
      request.reject(new AgentPlanCancelledError());
      return;
    }
    this.waiting.unshift(request);
    request.signal.addEventListener("abort", request.abort, { once: true });
  }

  private async transition(
    instanceId: string,
    state: AcpResourceState,
    stepId?: string,
  ): Promise<void> {
    await this.persist(async () => {
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
    const released = await this.persist(async () => {
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

  private isAtCapacity(): boolean {
    return (
      this.isReady &&
      this.waiting.some((request) => !this.isPaused(request)) &&
      this.active.size >= this.admissionCap()
    );
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
    return (
      acpMemoryWaitReason(this.options, this.availableMemory) ?? "capacity"
    );
  }
}
