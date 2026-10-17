import { SerialQueue } from "@/backend/concurrency/SerialQueue";

import { loggingFailureCode, writeLogFallback } from "./LogFallback";
import { openDailyLog, prepareLogDirectory } from "./LogFiles";
import { logDate } from "./LogCalendar";
import { LogWriterLock } from "./LogWriterLock";

import type { FileHandle } from "node:fs/promises";
import type { LoggingStatus } from "@/definition/Logging";

const MAXIMUM_QUEUE_BYTES = 8 * 1024 * 1024;
const MAXIMUM_QUEUE_ENTRIES = 2_048;
const RETRY_MS = 5_000;

interface PendingLine {
  readonly line: string;
  readonly date: string;
  readonly bytes: number;
  isMirrored: boolean;
}

/** Bounded, ordered async append writer with one exclusive owner per instance directory. */
export class DailyLogWriter {
  private readonly instanceId: string;
  private readonly pending: PendingLine[] = [];
  private readonly storage = new SerialQueue();
  private readonly ownership: LogWriterLock;
  private directory: string | null = null;
  private handle: FileHandle | null = null;
  private openDate: string | null = null;
  private draining: Promise<void> | null = null;
  private retry: NodeJS.Timeout | null = null;
  private queuedBytes = 0;
  private lostEntries = 0;
  private failureCode: string | null = null;
  private isClosed = false;
  private isReady = false;

  public constructor(instanceId: string) {
    this.instanceId = instanceId;
    this.ownership = new LogWriterLock(instanceId);
  }

  /** Sets the instance path before configuration/database initialization can fail. */
  public async start(directory: string): Promise<void> {
    if (this.directory !== null) return;
    this.directory = directory;
    try {
      await this.acquire();
    } catch (error: unknown) {
      this.failed(error);
    }
    this.drain();
  }

  /** Enqueues a sanitized line using the date captured with the event, never the drain time. */
  public append(line: string, date: string): void {
    const bytes = Buffer.byteLength(line);
    if (
      this.isClosed ||
      this.pending.length >= MAXIMUM_QUEUE_ENTRIES ||
      this.queuedBytes + bytes > MAXIMUM_QUEUE_BYTES
    ) {
      this.lostEntries += 1;
      if (this.failureCode !== "LOG_QUEUE_OVERFLOW")
        this.notice(
          "logging.queue.overflow",
          "Log queue full or closed; records fall back to stderr and are missing from the file",
          "LOG_QUEUE_OVERFLOW",
        );
      this.failureCode = "LOG_QUEUE_OVERFLOW";
      writeLogFallback(line);
      return;
    }
    const isMirrored = this.directory === null || this.failureCode !== null;
    this.pending.push({ line, date, bytes, isMirrored });
    this.queuedBytes += bytes;
    if (isMirrored) writeLogFallback(line);
    this.drain();
  }

  /** Serializes cleanup against file rotation and protects open/queued calendar dates. */
  public async withFiles<Result>(
    work: (protectedDates: ReadonlySet<string>) => Promise<Result>,
  ): Promise<Result> {
    return this.storage.run(async () => {
      if (!this.ownership.isHeld())
        throw new Error("Log writer is unavailable");
      if (
        this.openDate !== null &&
        this.openDate !== logDate(new Date()) &&
        !this.pending.some((entry) => entry.date === this.openDate)
      )
        await this.closeFile();
      const protectedDates = new Set(this.pending.map((entry) => entry.date));
      if (this.openDate !== null) protectedDates.add(this.openDate);
      return work(protectedDates);
    });
  }

  /** Snapshot for the administrator; no paths, secrets or raw errors leave the backend. */
  public status(): LoggingStatus {
    let state: LoggingStatus["state"] = "starting";
    if (this.failureCode !== null || this.lostEntries > 0) state = "degraded";
    else if (this.isReady) state = "healthy";
    return {
      state,
      queuedEntries: this.pending.length,
      lostEntries: this.lostEntries,
      failureCode: this.failureCode,
    };
  }

  /** Keeps malformed-event losses visible to administrators even after writes recover. */
  public recordSerializationLoss(): void {
    this.lostEntries += 1;
    this.failureCode = "LOG_SERIALIZATION_ERROR";
  }

  /** Drains accepted records and synchronizes the file; unavailable storage remains explicit. */
  public async flush(): Promise<void> {
    if (this.retry !== null) {
      clearTimeout(this.retry);
      this.retry = null;
    }
    this.drain();
    await this.draining;
    await this.storage.run(async () => {
      await this.handle?.datasync();
    });
  }

  /** Ends the writer after producers stopped and releases only its own lock. */
  public async close(): Promise<void> {
    try {
      await this.flush();
    } catch (error: unknown) {
      this.failed(error);
    }
    this.isClosed = true;
    if (this.retry !== null) clearTimeout(this.retry);
    for (const entry of this.pending) {
      this.lostEntries += 1;
      if (!entry.isMirrored) writeLogFallback(entry.line);
    }
    if (this.pending.length > 0)
      this.notice(
        "logging.shutdown.loss",
        "Shutdown could not persist all accepted records; records sent to stderr",
        this.failureCode ?? "LOG_IO_ERROR",
      );
    this.pending.length = 0;
    await this.storage.run(async () => {
      await this.closeFile();
      await this.ownership.release();
    });
  }

  private async acquire(): Promise<void> {
    if (this.directory === null) return;
    if (this.ownership.isHeld()) return;
    await prepareLogDirectory(this.directory);
    const recovery = await this.ownership.acquire(this.directory);
    this.isReady = true;
    if (recovery !== "none") {
      const captured = new Date();
      this.append(
        `${JSON.stringify({ schemaVersion: 1, time: captured.toISOString(), severity: "warn", event: "logging.ownership.recovered", component: "DailyLogWriter", pid: process.pid, instanceId: this.instanceId, message: "Unheld log ownership record recovered automatically", metadata: { reason: recovery } })}\n`,
        logDate(captured),
      );
    }
  }

  private drain(): void {
    if (
      this.directory === null ||
      this.pending.length === 0 ||
      this.draining !== null ||
      this.retry !== null ||
      this.isClosed
    )
      return;
    this.draining = this.storage
      .run(() => this.writePending())
      .finally(() => {
        this.draining = null;
        if (this.pending.length > 0 && this.retry === null) this.drain();
      });
  }

  private async writePending(): Promise<void> {
    try {
      await this.acquire();
      while (this.pending.length > 0) {
        const entry = this.pending[0];
        if (!entry || this.directory === null) break;
        if (entry.date !== this.openDate || this.handle === null) {
          await this.closeFile();
          this.handle = await openDailyLog(this.directory, entry.date);
          this.openDate = entry.date;
        }
        await this.writeLine(entry.line);
        this.pending.shift();
        this.queuedBytes -= entry.bytes;
      }
      await this.handle?.datasync();
      if (this.failureCode !== null)
        this.notice(
          "logging.write.recovered",
          "Log writing resumed",
          this.failureCode,
        );
      this.failureCode = null;
    } catch (error: unknown) {
      await this.closeFile().catch(() => {
        this.handle = null;
      });
      this.failed(error);
    }
  }

  private async writeLine(line: string): Promise<void> {
    const bytes = Buffer.from(line);
    let offset = 0;
    while (offset < bytes.length && this.handle !== null) {
      const result = await this.handle.write(
        bytes,
        offset,
        bytes.length - offset,
      );
      if (result.bytesWritten === 0) throw new Error("Zero-byte log write");
      offset += result.bytesWritten;
    }
  }

  private async closeFile(): Promise<void> {
    const handle = this.handle;
    this.handle = null;
    this.openDate = null;
    await handle?.close();
  }

  private failed(error: unknown): void {
    const code = loggingFailureCode(error);
    if (this.failureCode !== code)
      this.notice(
        "logging.write.failed",
        "File logging unavailable; bounded retry queue active",
        code,
      );
    this.failureCode = code;
    for (const entry of this.pending) {
      if (entry.isMirrored) continue;
      writeLogFallback(entry.line);
      entry.isMirrored = true;
    }
    if (this.retry === null && !this.isClosed) {
      this.retry = setTimeout(() => {
        this.retry = null;
        this.drain();
      }, RETRY_MS);
      this.retry.unref();
    }
  }

  private notice(event: string, message: string, code: string): void {
    writeLogFallback(
      `${JSON.stringify({ schemaVersion: 1, time: new Date().toISOString(), severity: "warn", event, component: "DailyLogWriter", pid: process.pid, instanceId: this.instanceId, message, code, lost: this.lostEntries, pending: this.pending.length })}\n`,
    );
  }
}
