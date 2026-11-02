import { withDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { loggedJob } from "@/backend/logging/LoggedOperation";
import {
  logCaughtError,
  logDiagnostic,
  logEvent,
} from "@/backend/logging/Logger";

import type { GitHubSyncService } from "@/backend/service/GitHubSyncService";

/** Longest time `stop()` waits for a running round before shutdown goes on. */
const STOP_WAIT_MS = 10_000;

/** Completed and failed project runs of one scheduled round. */
interface SyncRoundResult {
  readonly completed: number;
  readonly failed: number;
}

/**
 * Runs project synchronizations on a fixed server-side interval.
 *
 * @remarks
 * At most one round runs at a time. A tick that arrives while a round is
 * still running is skipped and logged as `job.github_sync.skipped`; nothing
 * is queued, because the due projects stay due in the database and the next
 * regular tick picks them up. Rounds run as recurring database work, so a
 * busy database serves them only with a small share of its queue.
 */
export class GitHubSyncScheduler {
  private readonly syncService: GitHubSyncService;
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private round: Promise<SyncRoundResult> | null = null;
  private roundStartedAt = 0;
  private skippedTicks = 0;

  /**
   * Creates a synchronization scheduler.
   *
   * @param syncService - Service executing the due project runs.
   * @param intervalMs - Polling interval in milliseconds.
   */
  public constructor(syncService: GitHubSyncService, intervalMs = 60_000) {
    this.syncService = syncService;
    this.intervalMs = intervalMs;
  }

  /** Starts periodic synchronization runs exactly once per scheduler. */
  public start(): void {
    if (this.timer !== null) {
      return;
    }

    const timer = setInterval(() => {
      void this.runDueSyncs();
    }, this.intervalMs);

    timer.unref();

    this.timer = timer;
  }

  /**
   * Stops periodic synchronization runs and waits for a running round,
   * at most {@link STOP_WAIT_MS} milliseconds.
   */
  public async stop(): Promise<void> {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (this.round === null) {
      return;
    }

    if (!(await finishesWithin(this.round, STOP_WAIT_MS))) {
      logEvent({
        level: "warn",
        event: "job.github_sync.stop_timeout",
        component: "GitHubSyncScheduler",
        message: "Shutdown continues while a GitHub synchronization round runs",
        metadata: { durationMs: performance.now() - this.roundStartedAt },
      });
    }
  }

  /**
   * Executes one round of due synchronizations, never throwing.
   *
   * @returns Completed and failed run counters; both are zero when the call
   * was skipped because another round is still running.
   */
  public async runDueSyncs(): Promise<SyncRoundResult> {
    if (this.round !== null) {
      this.recordSkippedTick();

      return { completed: 0, failed: 0 };
    }

    this.skippedTicks = 0;
    this.roundStartedAt = performance.now();
    const round = this.runRound();
    this.round = round;

    try {
      return await round;
    } finally {
      this.round = null;
    }
  }

  private async runRound(): Promise<SyncRoundResult> {
    try {
      return await withDatabaseWork(
        { workClass: "recurring", signal: undefined },
        () =>
          loggedJob("GitHubSyncScheduler", "job.github_sync", () =>
            this.syncService.runScheduledSyncs(),
          ),
      );
    } catch (error: unknown) {
      logCaughtError("GitHubSyncScheduler", error);

      logDiagnostic(
        "GitHubSyncScheduler",
        "error",
        "Pages scheduled GitHub synchronization failed.",
        error,
      );

      return { completed: 0, failed: 0 };
    }
  }

  private recordSkippedTick(): void {
    this.skippedTicks += 1;
    logEvent({
      level: "warn",
      event: "job.github_sync.skipped",
      component: "GitHubSyncScheduler",
      message: "GitHub synchronization tick skipped; the last round still runs",
      metadata: {
        count: this.skippedTicks,
        durationMs: performance.now() - this.roundStartedAt,
      },
    });
  }
}

/**
 * Waits for `work`, but no longer than `timeoutMs`.
 *
 * @returns Whether the work finished in time.
 */
async function finishesWithin(
  work: Promise<unknown>,
  timeoutMs: number,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      resolve(false);
    }, timeoutMs);
  });

  try {
    return await Promise.race([work.then(() => true), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
