import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { withoutReadScope } from "@/backend/database/ReadScope";
import { logCaughtError } from "@/backend/logging/Logger";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { LocalJournalCompaction } from "./LocalJournalCompaction";

/** Coalesces cleanup requests, independently of ACP acceptance and database commits. */
export class LocalJournalGarbage {
  private readonly compaction: LocalJournalCompaction;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: Promise<void> = Promise.resolve();
  private database: Pick<DatabaseTransaction, "query"> | null = null;
  private isRunning = false;
  private isRequested = false;
  private isClosed = false;

  public constructor(compaction: LocalJournalCompaction) {
    this.compaction = compaction;
  }

  /** Requests a background sweep soon; idle instances also sweep once per minute. */
  public schedule(database: Pick<DatabaseTransaction, "query">): void {
    if (this.isClosed) return;
    this.database = database;
    if (this.isRequested) return;
    this.isRequested = true;
    if (!this.isRunning) this.arm(1000);
  }

  /** Flushes currently requested work, without waiting for the periodic timer. */
  public async idle(): Promise<void> {
    if (!this.isRunning && this.isRequested) this.start();
    await this.pending;
    if (this.isRequested && !this.isClosed) await this.idle();
  }

  /** Stops timers and waits for an in-progress sweep before its database closes. */
  public async close(): Promise<void> {
    this.isClosed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    await this.pending;
  }

  private arm(delay: number): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.start(), delay);
    this.timer.unref();
  }

  private start(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const database = this.database;
    if (this.isClosed || this.isRunning || database === null) return;
    this.isRequested = false;
    this.isRunning = true;
    this.pending = withoutReadScope(() =>
      withBackgroundDatabaseWork("local_journal_compaction", async () => {
        try {
          await this.compaction.run(database);
        } catch (error: unknown) {
          logCaughtError("LocalJournalGarbage", error);
        } finally {
          this.isRunning = false;
          if (!this.isClosed) this.arm(this.isRequested ? 1000 : 60_000);
        }
      }),
    );
  }
}
