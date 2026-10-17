import { lstat, readdir, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  DEFAULT_LOG_RETENTION_DAYS,
  isLogRetentionDays,
} from "@/definition/Logging";

import { dailyLogDate, logDate, oldestLogDate } from "./LogCalendar";

import type { DailyLogWriter } from "./DailyLogWriter";
import type { ServerLogEvent } from "./Logger";

/** Calendar cleanup serialized with the writer; never traverses directories or symlinks. */
export class LogRetention {
  private readonly directory: string;
  private readonly writer: DailyLogWriter;
  private readonly emit: (event: ServerLogEvent) => void;
  private days = DEFAULT_LOG_RETENTION_DAYS;
  private running: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;

  public constructor(
    directory: string,
    writer: DailyLogWriter,
    emit: (event: ServerLogEvent) => void,
  ) {
    this.directory = directory;
    this.writer = writer;
    this.emit = emit;
  }

  /** Applies a persisted setting immediately and cleans up, including after downtime. */
  public async update(days: number, reason = "configuration"): Promise<void> {
    if (!isLogRetentionDays(days)) throw new Error("Invalid log retention");
    this.days = days;
    // A change during a running cleanup always gets its own pass afterwards.
    await this.running;
    await this.cleanup(reason);
    this.schedule();
  }

  /** Coalesces overlapping cleanup requests; failed files remain eligible next time. */
  public async cleanup(reason: string): Promise<void> {
    if (this.running !== null) return this.running;
    this.running = this.run(reason).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Stops the calendar timer and waits for any current cleanup. */
  public async close(): Promise<void> {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    await this.running;
  }

  private async run(reason: string): Promise<void> {
    const jobId = randomUUID();
    const days = this.days;
    let deleted = 0;
    let failed = 0;
    try {
      if (days > 0) {
        await this.writer.withFiles(async (protectedDates) => {
          const now = new Date();
          const today = logDate(now);
          const cutoff = oldestLogDate(now, days);
          for (const name of await readdir(this.directory)) {
            if (this.days !== days) break;
            const date = dailyLogDate(name);
            if (
              date === null ||
              date >= cutoff ||
              date > today ||
              protectedDates.has(date)
            )
              continue;
            const outcome = await this.remove(name, jobId);
            if (outcome === "deleted") deleted += 1;
            if (outcome === "failed") failed += 1;
          }
        });
      }
      this.emit({
        level: failed > 0 ? "warn" : "info",
        event: "logging.cleanup.completed",
        component: "LogRetention",
        message: "Log retention cleanup completed",
        metadata: { jobId, reason, retentionDays: days, deleted, failed },
      });
    } catch (error: unknown) {
      this.emit({
        level: "error",
        event: "logging.cleanup.failed",
        component: "LogRetention",
        message: "Log retention cleanup could not finish; it will be retried",
        error,
        metadata: {
          jobId,
          reason,
          retentionDays: days,
          deleted,
          failed: failed + 1,
        },
      });
    }
  }

  private async remove(
    name: string,
    jobId: string,
  ): Promise<"deleted" | "skipped" | "failed"> {
    const filePath = path.join(this.directory, name);
    try {
      const stats = await lstat(filePath);
      if (!stats.isFile() || stats.isSymbolicLink()) return "skipped";
      await unlink(filePath);
      return "deleted";
    } catch (error: unknown) {
      this.emit({
        level: "error",
        event: "logging.cleanup.delete_failed",
        component: "LogRetention",
        message:
          "An expired daily log could not be removed; retry remains possible",
        error,
        metadata: { jobId },
      });
      return "failed";
    }
  }

  private schedule(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    const next = new Date();
    next.setHours(24, 0, 0, 0);
    this.timer = setTimeout(
      () => {
        void this.cleanup("day_changed").finally(() => {
          this.schedule();
        });
      },
      Math.max(1, next.getTime() - Date.now()),
    );
    this.timer.unref();
  }
}
