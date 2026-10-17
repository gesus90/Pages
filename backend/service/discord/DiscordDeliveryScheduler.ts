import { loggedJob } from "@/backend/logging/LoggedOperation";
import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";

import type { DiscordDeliveryWorker } from "@/backend/service/discord/DiscordDeliveryWorker";

/** Delivers stored Discord messages on a fixed interval and on request. */
export class DiscordDeliveryScheduler {
  private readonly worker: Pick<DiscordDeliveryWorker, "runDue">;
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | null = null;

  /**
   * Creates a delivery scheduler.
   *
   * @param worker - Worker that sends the messages that are due.
   * @param intervalMs - Polling interval in milliseconds; it picks up the
   * retries and the messages that survived a restart.
   */
  public constructor(
    worker: Pick<DiscordDeliveryWorker, "runDue">,
    intervalMs = 15_000,
  ) {
    this.worker = worker;
    this.intervalMs = intervalMs;
  }

  /** Starts the periodic delivery exactly once per scheduler. */
  public start(): void {
    if (this.timer !== null) {
      return;
    }

    const timer = setInterval(() => {
      void this.run();
    }, this.intervalMs);

    timer.unref();

    this.timer = timer;
    // Messages stored before the last stop do not wait for the first tick.
    this.kick();
  }

  /** Stops the periodic delivery. */
  public stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Delivers soon, without waiting for the next interval. */
  public kick(): void {
    setTimeout(() => {
      void this.run();
    }, 0).unref();
  }

  /**
   * Runs one round of deliveries, never throwing.
   *
   * @returns Whether the round completed.
   */
  public async run(): Promise<boolean> {
    try {
      await loggedJob("DiscordDeliveryScheduler", "job.discord_delivery", () =>
        this.worker.runDue(),
      );

      return true;
    } catch (error: unknown) {
      logCaughtError("DiscordDeliveryScheduler", error);

      logDiagnostic(
        "DiscordDeliveryScheduler",
        "error",
        "Pages could not deliver Discord notifications.",
        error,
      );

      return false;
    }
  }
}
