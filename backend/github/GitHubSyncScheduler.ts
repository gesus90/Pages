import type { GitHubSyncService } from "@/backend/service/GitHubSyncService";

/** Runs project synchronizations on a fixed server-side interval. */
export class GitHubSyncScheduler {
  private readonly syncService: GitHubSyncService;
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | null = null;

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

  /** Stops periodic synchronization runs. */
  public stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Executes one round of due synchronizations, never throwing.
   *
   * @returns Completed and failed run counters.
   */
  public async runDueSyncs(): Promise<{
    readonly completed: number;
    readonly failed: number;
  }> {
    try {
      return await this.syncService.runScheduledSyncs();
    } catch (error: unknown) {
      console.error("Pages scheduled GitHub synchronization failed.", error);

      return { completed: 0, failed: 0 };
    }
  }
}
