import type { WikiService } from "@/backend/service/WikiService";

/** Cleans up the wiki once at the start and then at a fixed interval. */
export class WikiMaintenanceScheduler {
  private readonly wikiService: Pick<WikiService, "runMaintenance">;
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | null = null;

  /**
   * Creates the scheduler.
   *
   * @param wikiService - Service that removes what outlived its retention.
   * @param intervalMs - Time between two cleanups in milliseconds.
   */
  public constructor(
    wikiService: Pick<WikiService, "runMaintenance">,
    intervalMs = 60 * 60 * 1000,
  ) {
    this.wikiService = wikiService;
    this.intervalMs = intervalMs;
  }

  /** Runs a cleanup now and repeats it; calling it again does nothing. */
  public start(): void {
    if (this.timer !== null) {
      return;
    }

    void this.runOnce();

    const timer = setInterval(() => {
      void this.runOnce();
    }, this.intervalMs);

    timer.unref();

    this.timer = timer;
  }

  /** Stops the repeated cleanups. */
  public stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Runs one cleanup and never throws.
   *
   * @returns Whether the cleanup finished.
   */
  public async runOnce(): Promise<boolean> {
    try {
      await this.wikiService.runMaintenance();

      return true;
    } catch (error: unknown) {
      console.error("Pages wiki maintenance failed.", error);

      return false;
    }
  }
}
