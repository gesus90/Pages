import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import { readSlowOperationThresholdMs } from "@/backend/logging/LogTiming";
import { recordDatabaseWaitMetrics } from "@/backend/logging/DatabaseLogMetrics";

import { recordDatabaseQuery } from "../DatabaseStats";
import { DatabaseLane } from "./DatabaseLane";
import { DatabaseWalGrowth } from "./DatabaseWalGrowth";
import { DATABASE_EXECUTOR_LIMITS } from "./DatabaseExecutorLimits";
import { DatabaseExecutorError } from "./DatabaseExecutorErrors";
import {
  DatabaseWorkerClient,
  withDeadline,
  WorkerStatementError,
} from "./DatabaseWorkerClient";
import { currentDatabaseWork } from "./DatabaseWorkContext";

import type { DatabaseValue, SqlParameters } from "../Database";
import type { LaneStatus } from "./DatabaseLane";
import type {
  DatabaseWorkerStatus,
  WorkerOutcome,
  WorkerStatement,
} from "./DatabaseWorkerClient";
import type {
  WireValue,
  WorkerRefusalName,
  WorkerRunMode,
} from "./DatabaseWorkerProtocol";

/** Statement access to the writer, bound to one worker for a whole job. */
export interface WriterSession {
  /** Runs one statement on the writer connection. */
  run(
    statement: string,
    parameters: SqlParameters,
    mode: WorkerRunMode,
  ): Promise<readonly DatabaseValue[][]>;
}

/** Read access bound to one snapshot on a reserved reader connection. */
export interface ReaderSession {
  /** Runs one SELECT inside the session's read-only transaction. */
  query(
    statement: string,
    parameters: SqlParameters,
  ): Promise<readonly DatabaseValue[][]>;
}

/** Executor snapshot for `/health` and diagnostics; it holds no SQL or values. */
export interface DatabaseExecutorStatus {
  readonly worker: DatabaseWorkerStatus;
  readonly writer: LaneStatus;
  readonly readers: LaneStatus;
  readonly readerConnections: number;
  readonly reroutedReads: number;
}

const NOT_READ_ONLY: WorkerRefusalName = "DatabaseNotReadOnlyError";

/** How often the counters of the executor reach the log while it does anything. */
const STATUS_REPORT_INTERVAL_MS = 60_000;

/** Origins reported per interval, the largest growth first. */
const MAXIMUM_REPORTED_WAL_ORIGINS = 10;

/** Text DuckDB reports once a fatal error invalidated the open database. */
export const DATABASE_INVALIDATED = "database has been invalidated";

function estimateParameterBytes(parameters: SqlParameters): number {
  let bytes = 0;
  for (const value of Object.values(parameters)) {
    if (typeof value === "string") bytes += value.length * 2;
    else if (Buffer.isBuffer(value)) bytes += value.byteLength;
    bytes += 8;
  }
  return bytes;
}

/** Restores `Buffer` for blobs that crossed the boundary as plain byte arrays. */
function toDatabaseRows(rows: WireValue[][] | null): DatabaseValue[][] {
  if (rows === null) return [];
  for (const row of rows)
    for (let index = 0; index < row.length; index += 1) {
      const value = row[index];
      if (value instanceof Uint8Array && !Buffer.isBuffer(value))
        row[index] = Buffer.from(
          value.buffer,
          value.byteOffset,
          value.byteLength,
        );
    }
  return rows as DatabaseValue[][];
}

function isCommitLike(statement: string): boolean {
  return /^\s*(?:COMMIT|CHECKPOINT)\b/iu.test(statement);
}

/** Whether a writer job holds an open transaction after `statement`. */
function holdsTransaction(statement: string, wasOpen: boolean): boolean {
  if (/^\s*BEGIN\b/iu.test(statement)) return true;
  return wasOpen && !/^\s*(?:COMMIT|ROLLBACK)\b/iu.test(statement);
}

function laneCounters(
  prefix: "writer" | "reader",
  lane: LaneStatus,
): Readonly<Record<string, number>> {
  return {
    [`${prefix}Queued`]: lane.queued,
    [`${prefix}Running`]: lane.running,
    [`${prefix}Completed`]: lane.completed,
    [`${prefix}RefusedOverloaded`]: lane.refusedOverloaded,
    [`${prefix}RefusedQueueTimeout`]: lane.refusedQueueTimeout,
    [`${prefix}RefusedAborted`]: lane.refusedAborted,
    [`${prefix}LongestQueueWaitMs`]: lane.longestQueueWaitMs,
  };
}

/**
 * Runs the statements of the server on the database worker (PAGE-197).
 *
 * @remarks
 * Writes queue in the writer lane and run one job at a time on the single
 * writer connection; a transaction is one job, so its statements stay
 * together. Reads queue in their own lane and run on the reader
 * connections of the same DuckDB instance, so a long write never holds them
 * back. Both lanes are bounded and refuse jobs only before they started.
 */
export class DatabaseExecutor {
  private readonly client: DatabaseWorkerClient;
  private readonly writerLane = new DatabaseLane({
    concurrency: 1,
    maximumQueued: DATABASE_EXECUTOR_LIMITS.maximumQueuedWrites,
    maximumQueuedRecurring:
      DATABASE_EXECUTOR_LIMITS.maximumQueuedBackgroundWrites,
  });
  private readonly readerLane = new DatabaseLane({
    concurrency: DATABASE_EXECUTOR_LIMITS.readsInFlight,
    maximumQueued: DATABASE_EXECUTOR_LIMITS.maximumQueuedReads,
    maximumQueuedRecurring: DATABASE_EXECUTOR_LIMITS.maximumQueuedReads,
  });
  private readonly walGrowth = new DatabaseWalGrowth();
  private readonly statusTimer: NodeJS.Timeout;
  private reroutedReads = 0;
  private lastReportedJobs = 0;
  private readonly onInvalidated: (error: Error) => void;

  private constructor(
    client: DatabaseWorkerClient,
    onInvalidated: (error: Error) => void,
  ) {
    this.client = client;
    this.onInvalidated = onInvalidated;
    this.statusTimer = setInterval(
      () => this.reportStatus(),
      STATUS_REPORT_INTERVAL_MS,
    );
    this.statusTimer.unref();
  }

  /**
   * Starts the worker and waits until it opened the database.
   *
   * @param databasePath - File system path, or `:memory:`.
   * @param onInvalidated - Called once DuckDB invalidated the database.
   * @returns The ready executor.
   */
  public static async start(
    databasePath: string,
    onInvalidated: (error: Error) => void,
  ): Promise<DatabaseExecutor> {
    const client = await DatabaseWorkerClient.start({
      databasePath,
      readerConnections: DATABASE_EXECUTOR_LIMITS.readerConnections,
      maximumResultBytes: DATABASE_EXECUTOR_LIMITS.maximumResultBytes,
    });
    return new DatabaseExecutor(client, onInvalidated);
  }

  /**
   * Runs one writer job: a statement or a whole transaction.
   *
   * @param work - Receives the writer, bound to the current worker.
   * @returns Whatever `work` returns.
   * @throws {DatabaseOverloadedError} When the job was refused unstarted.
   */
  public write<Result>(
    work: (writer: WriterSession) => Promise<Result>,
  ): Promise<Result> {
    const context = currentDatabaseWork();
    const budgetMs =
      context.workClass === "request"
        ? DATABASE_EXECUTOR_LIMITS.requestWriteQueueBudgetMs
        : DATABASE_EXECUTOR_LIMITS.backgroundWriteQueueBudgetMs;
    return this.writerLane.schedule(
      (queueMs) => {
        this.reportWait("writer", queueMs);
        const generation = this.client.currentGeneration;
        let isInTransaction = false;
        return work({
          run: (statement, parameters, mode) => {
            // DuckDB writes the log when a change commits, so nothing inside an
            // open transaction but its end can make the log grow.
            const measureWal = !isInTransaction || isCommitLike(statement);
            isInTransaction = holdsTransaction(statement, isInTransaction);
            return this.runStatement(statement, parameters, {
              mode,
              role: "writer",
              generation,
              measureWal,
            });
          },
        });
      },
      { workClass: context.workClass, budgetMs, signal: context.signal },
    );
  }

  /**
   * Runs one read on a reader connection, or on the writer when DuckDB
   * reports that the statement is no single SELECT.
   *
   * @param statement - SQL owned by a repository.
   * @param parameters - Values bound to the statement.
   * @returns The rows, as the last committed state shows them.
   */
  public async read(
    statement: string,
    parameters: SqlParameters,
  ): Promise<readonly DatabaseValue[][]> {
    const context = currentDatabaseWork();
    try {
      return await this.readerLane.schedule(
        (queueMs) => {
          this.reportWait("reader", queueMs);
          return this.runStatement(statement, parameters, {
            mode: "rows",
            role: "reader",
            generation: this.client.currentGeneration,
          });
        },
        {
          workClass: context.workClass,
          budgetMs: DATABASE_EXECUTOR_LIMITS.readQueueBudgetMs,
          signal: context.signal,
        },
      );
    } catch (error: unknown) {
      if (
        !(error instanceof WorkerStatementError) ||
        error.name !== NOT_READ_ONLY
      )
        throw error;
      this.reroutedReads += 1;
      return this.write((writer) => writer.run(statement, parameters, "rows"));
    }
  }

  /**
   * Runs several reads on one snapshot of the last committed state.
   *
   * @param work - Receives the session; its first query begins it.
   * @returns Whatever `work` returns, after the session ended.
   * @throws {DatabaseOverloadedError} When the job was refused unstarted.
   */
  public readSession<Result>(
    work: (session: ReaderSession) => Promise<Result>,
  ): Promise<Result> {
    const context = currentDatabaseWork();
    return this.readerLane.schedule(
      async (queueMs) => {
        this.reportWait("reader", queueMs);
        const generation = this.client.currentGeneration;
        const session = this.client.nextSession();
        let beginning: Promise<unknown> | null = null;
        try {
          return await work({
            query: async (statement, parameters) => {
              beginning ??= this.client.session("begin", session, generation);
              await beginning;
              return this.runStatement(statement, parameters, {
                mode: "rows",
                role: "reader",
                generation,
                session,
              });
            },
          });
        } finally {
          if (beginning !== null) await this.endSession(session, generation);
        }
      },
      {
        workClass: context.workClass,
        budgetMs: DATABASE_EXECUTOR_LIMITS.readQueueBudgetMs,
        signal: context.signal,
      },
    );
  }

  /** Lifecycle and queue counters, free of SQL and values. */
  public status(): DatabaseExecutorStatus {
    return {
      worker: this.client.status(),
      writer: this.writerLane.status(),
      readers: this.readerLane.status(),
      readerConnections: DATABASE_EXECUTOR_LIMITS.readerConnections,
      reroutedReads: this.reroutedReads,
    };
  }

  /** Lets the accepted jobs finish, then lets the worker checkpoint and close. */
  public async close(): Promise<void> {
    clearInterval(this.statusTimer);
    try {
      await this.drainLanes();
      // The counters live in this process; the last ones must not end with it.
      this.reportStatus();
    } catch (error: unknown) {
      // A diagnostic is no reason to leave the database open.
      logCaughtError("DatabaseExecutor", error);
    } finally {
      // Runs whatever happened above, and a failed close outranks all of it.
      await this.client.close();
    }
  }

  /**
   * Waits for the jobs the lanes accepted, because the worker refuses every
   * statement once it closes, also the COMMIT or ROLLBACK of a job still running.
   *
   * @remarks
   * A job that misses the deadline loses its uncommitted changes when the worker
   * rolls them back. The close cannot wait for it without end: the checkpoint
   * needs the time, and that job may never finish.
   */
  private async drainLanes(): Promise<void> {
    const isDrained = await withDeadline(
      Promise.all([this.writerLane.drain(), this.readerLane.drain()]).then(
        () => true,
      ),
      DATABASE_EXECUTOR_LIMITS.drainTimeoutMs,
      () => false,
    );
    if (isDrained) return;
    const writer = this.writerLane.status();
    const readers = this.readerLane.status();
    this.writerLane.refuseWaiting();
    this.readerLane.refuseWaiting();
    logEvent({
      level: "warn",
      event: "database.executor.drain_incomplete",
      component: "DatabaseExecutor",
      message:
        "Database jobs were still active when the worker had to close; their uncommitted changes are rolled back",
      metadata: {
        writerRunning: writer.running,
        writerQueued: writer.queued,
        readerRunning: readers.running,
        readerQueued: readers.queued,
      },
    });
  }

  private async endSession(session: number, generation: number): Promise<void> {
    try {
      await this.client.session("end", session, generation);
    } catch (error: unknown) {
      // The reads already answered; a failed end only costs the worker its reader.
      this.reportFailure("COMMIT", {}, error);
    }
  }

  private async runStatement(
    statement: string,
    parameters: SqlParameters,
    target: Pick<WorkerStatement, "mode" | "role"> & {
      readonly generation: number;
      readonly session?: number;
      readonly measureWal?: boolean;
    },
  ): Promise<DatabaseValue[][]> {
    if (
      estimateParameterBytes(parameters) >
      DATABASE_EXECUTOR_LIMITS.maximumParameterBytes
    )
      throw new Error(
        `Database parameters exceed ${String(DATABASE_EXECUTOR_LIMITS.maximumParameterBytes)} bytes.`,
      );
    try {
      const outcome = await this.client.run(
        {
          role: target.role,
          mode: target.mode,
          statement,
          parameters,
          measureWal: target.measureWal ?? false,
          session: target.session ?? null,
        },
        target.generation,
      );
      this.record(statement, target.role, outcome);
      return toDatabaseRows(outcome.rows);
    } catch (error: unknown) {
      this.reportFailure(statement, parameters, error);
      throw error;
    }
  }

  private record(
    statement: string,
    role: "writer" | "reader",
    outcome: WorkerOutcome,
  ): void {
    const { timing } = outcome;
    const ipcMs = Math.max(
      0,
      outcome.roundTripMs - timing.waitMs - timing.executionMs,
    );
    recordDatabaseWaitMetrics(timing.waitMs, ipcMs);
    recordDatabaseQuery(statement, timing.executionMs, {
      role,
      workerWaitMs: timing.waitMs,
      ipcMs,
      walBytesBefore: timing.walBytesBefore,
      walBytesAfter: timing.walBytesAfter,
    });
    const work = currentDatabaseWork();
    this.walGrowth.record(
      work.origin ?? work.workClass,
      timing.walBytesBefore,
      timing.walBytesAfter,
    );
  }

  /** Writes the counters of the lanes and the log growth; skips an idle interval. */
  private reportStatus(): void {
    const status = this.status();
    const jobs = status.writer.completed + status.readers.completed;
    const hasActivity =
      jobs !== this.lastReportedJobs ||
      status.writer.queued > 0 ||
      status.readers.queued > 0;
    if (!hasActivity) return;
    this.lastReportedJobs = jobs;
    logEvent({
      level: "info",
      event: "database.executor.status",
      component: "DatabaseExecutor",
      message: "Database executor counters",
      metadata: {
        state: status.worker.state,
        generation: status.worker.generation,
        restarts: status.worker.restarts,
        pendingStatements: status.worker.pendingStatements,
        reroutedReads: status.reroutedReads,
        ...laneCounters("writer", status.writer),
        ...laneCounters("reader", status.readers),
      },
    });
    for (const growth of this.walGrowth
      .drain()
      .slice(0, MAXIMUM_REPORTED_WAL_ORIGINS))
      logEvent({
        level: "info",
        event: "database.wal.growth",
        component: "DatabaseExecutor",
        message:
          "Write-ahead log growth of one kind of work since the last report",
        metadata: { ...growth },
      });
  }

  private reportWait(lane: "writer" | "reader", queueMs: number): void {
    recordDatabaseWaitMetrics(queueMs, 0);
    if (queueMs < readSlowOperationThresholdMs()) return;
    logEvent({
      level: "warn",
      event: "database.queue.slow",
      component: "DatabaseExecutor",
      message:
        "Database job waited longer than the slow-operation threshold for its turn",
      metadata: {
        lane,
        workClass: currentDatabaseWork().workClass,
        queueMs: Math.round(queueMs),
        queued:
          lane === "writer"
            ? this.writerLane.status().queued
            : this.readerLane.status().queued,
      },
    });
  }

  private reportFailure(
    statement: string,
    parameters: SqlParameters,
    error: unknown,
  ): void {
    if (error instanceof WorkerStatementError && error.name === NOT_READ_ONLY)
      return;
    if (error instanceof DatabaseExecutorError) return;
    logEvent({
      level: "error",
      event: "database.statement.failed",
      component: "Database",
      message: "Database statement failed",
      error,
      metadata: {
        parameterCount: Object.keys(parameters).length,
        operation:
          /^\s*([A-Za-z]+)/u.exec(statement)?.[1]?.toUpperCase() ?? "OTHER",
      },
    });
    if (error instanceof Error && error.message.includes(DATABASE_INVALIDATED))
      this.onInvalidated(error);
  }
}
