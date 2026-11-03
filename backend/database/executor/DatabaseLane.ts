import { AsyncResource } from "node:async_hooks";

import {
  DatabaseOverloadedError,
  DatabaseUnavailableError,
} from "./DatabaseExecutorErrors";

import type { DatabaseWorkClass } from "./DatabaseWorkContext";

/** How one job enters a lane. */
export interface LaneJobOptions {
  readonly workClass: DatabaseWorkClass;
  /** Longest wait for the turn; afterwards the job is refused unstarted. */
  readonly budgetMs: number;
  /** Refuses the job unstarted once the caller gave up, e.g. a closed request. */
  readonly signal: AbortSignal | undefined;
}

/** Counters of one lane for health and metrics. */
export interface LaneStatus {
  readonly queued: number;
  readonly running: number;
  readonly completed: number;
  readonly refusedOverloaded: number;
  readonly refusedQueueTimeout: number;
  readonly refusedAborted: number;
  /** Longest queue wait of a started job since the start. */
  readonly longestQueueWaitMs: number;
}

/** Bounds of one lane. */
export interface LaneLimits {
  /** Jobs that run at the same time. */
  readonly concurrency: number;
  /** Jobs that may wait. */
  readonly maximumQueued: number;
  /** Of those, jobs of recurring background work. */
  readonly maximumQueuedRecurring: number;
}

interface WaitingJob {
  readonly workClass: DatabaseWorkClass;
  readonly queuedAt: number;
  readonly start: () => void;
  readonly refuse: (reason: "queue_timeout" | "aborted" | "closing") => void;
}

/**
 * A bounded first-in-first-out queue in front of the writer or the readers.
 *
 * @remarks
 * Jobs start strictly in arrival order whatever their class, so neither
 * interactive requests, agent persistence nor background jobs can starve
 * each other; recurring background work only has a smaller share of the
 * waiting places. A job is refused with {@link DatabaseOverloadedError}
 * only before it started: when the queue is full, its budget ran out or its
 * caller aborted. A started job always runs to its end; the lane never
 * cancels it. Once the database closes, {@link DatabaseLane.drain} refuses new
 * jobs and lets the accepted ones finish.
 */
export class DatabaseLane {
  private readonly limits: LaneLimits;
  private readonly waiting: WaitingJob[] = [];
  private running = 0;
  private completed = 0;
  private refusedOverloaded = 0;
  private refusedQueueTimeout = 0;
  private refusedAborted = 0;
  private longestQueueWaitMs = 0;
  private isDraining = false;
  private onDrained: (() => void) | null = null;

  public constructor(limits: LaneLimits) {
    this.limits = limits;
  }

  /**
   * Runs `work` once a place is free.
   *
   * @param work - Receives the time the job waited, in milliseconds.
   * @param options - Class, budget and abort signal of the job.
   * @returns Whatever `work` returns.
   * @throws {DatabaseOverloadedError} When the job was refused unstarted.
   * @throws {DatabaseUnavailableError} When the database closes; it never started.
   */
  public schedule<Result>(
    work: (queueMs: number) => Promise<Result>,
    options: LaneJobOptions,
  ): Promise<Result> {
    if (this.isDraining) return this.refuse("closing");
    if (options.signal?.aborted) return this.refuse("aborted");
    if (this.running < this.limits.concurrency && this.waiting.length === 0)
      return this.start(work, performance.now());
    if (!this.hasPlace(options.workClass)) return this.refuse("overloaded");
    return new Promise<Result>((resolve, reject) => {
      const queuedAt = performance.now();
      const job: WaitingJob = {
        workClass: options.workClass,
        queuedAt,
        // The previous job's end starts this one; it must run in its caller's
        // async context, so logs, metrics and the work class stay its own.
        start: AsyncResource.bind(() => {
          release();
          this.start(work, queuedAt).then(resolve, reject);
        }),
        refuse: (reason) => {
          release();
          this.remove(job);
          this.refuse<Result>(reason).catch(reject);
        },
      };
      const timer = setTimeout(
        () => job.refuse("queue_timeout"),
        options.budgetMs,
      );
      const onAbort = (): void => job.refuse("aborted");
      options.signal?.addEventListener("abort", onAbort, { once: true });
      const release = (): void => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
      };
      this.waiting.push(job);
    });
  }

  /**
   * Refuses every later job and waits for the jobs the lane already accepted.
   *
   * @returns Settles once no job runs or waits any more.
   */
  public drain(): Promise<void> {
    this.isDraining = true;
    return new Promise((resolve) => {
      this.onDrained = resolve;
      this.settleDrain();
    });
  }

  /** Refuses the jobs that still wait; a started job runs on. */
  public refuseWaiting(): void {
    for (const job of [...this.waiting]) job.refuse("closing");
  }

  /** Counters of the lane. */
  public status(): LaneStatus {
    return {
      queued: this.waiting.length,
      running: this.running,
      completed: this.completed,
      refusedOverloaded: this.refusedOverloaded,
      refusedQueueTimeout: this.refusedQueueTimeout,
      refusedAborted: this.refusedAborted,
      longestQueueWaitMs: Math.round(this.longestQueueWaitMs),
    };
  }

  private hasPlace(workClass: DatabaseWorkClass): boolean {
    if (this.waiting.length >= this.limits.maximumQueued) return false;
    if (workClass !== "recurring") return true;
    const recurring = this.waiting.filter(
      (job) => job.workClass === "recurring",
    );
    return recurring.length < this.limits.maximumQueuedRecurring;
  }

  private async start<Result>(
    work: (queueMs: number) => Promise<Result>,
    queuedAt: number,
  ): Promise<Result> {
    this.running += 1;
    const queueMs = performance.now() - queuedAt;
    this.longestQueueWaitMs = Math.max(this.longestQueueWaitMs, queueMs);
    try {
      return await work(queueMs);
    } finally {
      this.running -= 1;
      this.completed += 1;
      this.next();
      this.settleDrain();
    }
  }

  private next(): void {
    if (this.running >= this.limits.concurrency) return;
    this.waiting.shift()?.start();
  }

  private remove(job: WaitingJob): void {
    const index = this.waiting.indexOf(job);
    if (index >= 0) this.waiting.splice(index, 1);
    this.settleDrain();
  }

  private settleDrain(): void {
    if (this.running === 0 && this.waiting.length === 0) this.onDrained?.();
  }

  private refuse<Result>(
    reason: "overloaded" | "queue_timeout" | "aborted" | "closing",
  ): Promise<Result> {
    if (reason === "closing")
      return Promise.reject(new DatabaseUnavailableError());
    if (reason === "overloaded") this.refusedOverloaded += 1;
    else if (reason === "queue_timeout") this.refusedQueueTimeout += 1;
    else this.refusedAborted += 1;
    return Promise.reject(new DatabaseOverloadedError(reason));
  }
}
