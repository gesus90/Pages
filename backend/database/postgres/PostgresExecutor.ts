import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import { recordDatabaseWaitMetrics } from "@/backend/logging/DatabaseLogMetrics";
import { registerLogSecret } from "@/backend/logging/LogRedaction";

import { DatabaseLane } from "../executor/DatabaseLane";
import { DATABASE_EXECUTOR_LIMITS } from "../executor/DatabaseExecutorLimits";
import { DatabaseUnavailableError } from "../executor/DatabaseExecutorErrors";
import { currentDatabaseWork } from "../executor/DatabaseWorkContext";
import { withDeadline } from "../executor/DatabaseWorkerClient";
import { PostgresConnection, postgresErrorCode } from "./PostgresConnection";
import { BYTEA_COLUMN_TYPE, createTypeParsers } from "./PostgresValues";

import type { Pool, PoolClient } from "pg";

import type { DatabaseEngine } from "../DatabaseEngine";
import type { DatabaseValue, SqlParameters } from "../Database";
import type {
  DatabaseExecutorStatus,
  ReaderSession,
  WriterSession,
} from "../executor/DatabaseExecutor";
import type { DatabaseWorkerState } from "../executor/DatabaseWorkerClient";
import type { PostgresConnectionRole } from "./PostgresConnection";

/** Connections of the pool: one always stays free for the writer. */
const POOL_SIZE = 10;
const READER_CONNECTIONS = POOL_SIZE - 1;

/** Longest wait for a new connection; without a limit a lost server hangs a lane. */
const CONNECTION_TIMEOUT_MS = 10_000;

/** A commit is confirmed only once it is durable, whatever the server defaults to. */
const CONNECTION_OPTIONS = "-c synchronous_commit=on";

const BEGIN_SNAPSHOT =
  "BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ;";

/**
 * Keeps the secret parts of the URL out of every later log text.
 *
 * @remarks
 * Nothing in this path logs the URL. This holds for a driver message that
 * ever quotes it, too.
 */
function protectDatabaseUrl(databaseUrl: string): void {
  registerLogSecret(databaseUrl);
  const { password } = new URL(databaseUrl);
  registerLogSecret(password);
  registerLogSecret(decodeURIComponent(password));
}

/**
 * Runs the statements of the server on a PostgreSQL connection pool.
 *
 * @remarks
 * Repositories rely on one writer: a transaction reads and writes without any
 * other change between its statements. The writer lane therefore keeps running
 * one job at a time on one connection, also here, until the repositories are
 * ported; reads share the other connections and see the last committed state.
 * The lanes and their budgets are those of `DatabaseExecutor`.
 */
export class PostgresExecutor implements DatabaseEngine {
  private readonly pool: Pool;
  private readonly writerLane = new DatabaseLane({
    concurrency: 1,
    maximumQueued: DATABASE_EXECUTOR_LIMITS.maximumQueuedWrites,
    maximumQueuedRecurring:
      DATABASE_EXECUTOR_LIMITS.maximumQueuedBackgroundWrites,
  });
  private readonly readerLane = new DatabaseLane({
    concurrency: READER_CONNECTIONS,
    maximumQueued: DATABASE_EXECUTOR_LIMITS.maximumQueuedReads,
    maximumQueuedRecurring: DATABASE_EXECUTOR_LIMITS.maximumQueuedReads,
  });
  private state: DatabaseWorkerState = "ready";

  private constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Opens the pool and proves that a connection works.
   *
   * @param databaseUrl - The connection URL; it is never logged.
   * @returns The ready executor.
   * @throws The error of the driver or server when no connection opens, for
   * example SQLSTATE `28P01` for a wrong password.
   */
  public static async start(databaseUrl: string): Promise<PostgresExecutor> {
    protectDatabaseUrl(databaseUrl);
    // Loaded here, so an instance on DuckDB never touches the driver.
    const { Pool: DriverPool, types } = await import("pg");
    const pool = new DriverPool({
      connectionString: databaseUrl,
      max: POOL_SIZE,
      connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
      keepAlive: true,
      options: CONNECTION_OPTIONS,
      types: createTypeParsers(types.getTypeParser(BYTEA_COLUMN_TYPE)),
    });
    // Without a listener a lost idle connection ends the process.
    pool.on("error", (error) => {
      logEvent({
        level: "warn",
        event: "database.connection.idle_lost",
        component: "Database",
        message: "An idle PostgreSQL connection ended; the pool replaces it",
        error,
        metadata: { code: postgresErrorCode(error) },
      });
    });
    try {
      (await pool.connect()).release();
    } catch (error: unknown) {
      await pool.end();
      throw error;
    }
    return new PostgresExecutor(pool);
  }

  /**
   * Runs one writer job: a statement or a whole transaction.
   *
   * @param work - Receives the writer, bound to one connection.
   * @returns Whatever `work` returns.
   * @throws {DatabaseOverloadedError} When the job was refused unstarted.
   */
  public write<Result>(
    work: (writer: WriterSession) => Promise<Result>,
  ): Promise<Result> {
    const context = currentDatabaseWork();
    return this.writerLane.schedule(
      (queueMs) => {
        recordDatabaseWaitMetrics(queueMs, 0);
        return this.withConnection("writer", (connection) =>
          work({
            run: (statement, parameters, mode) =>
              connection.run(statement, parameters, mode),
          }),
        );
      },
      {
        workClass: context.workClass,
        budgetMs:
          context.workClass === "request"
            ? DATABASE_EXECUTOR_LIMITS.requestWriteQueueBudgetMs
            : DATABASE_EXECUTOR_LIMITS.backgroundWriteQueueBudgetMs,
        signal: context.signal,
      },
    );
  }

  /**
   * Runs one read on a reader connection.
   *
   * @param statement - SQL owned by a repository.
   * @param parameters - Values bound to the statement.
   * @returns The rows, as the last committed state shows them.
   */
  public read(
    statement: string,
    parameters: SqlParameters,
  ): Promise<readonly DatabaseValue[][]> {
    return this.scheduleRead((connection) =>
      connection.run(statement, parameters, "rows"),
    );
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
    return this.scheduleRead(async (connection) => {
      let beginning: Promise<unknown> | null = null;
      try {
        return await work({
          query: async (statement, parameters) => {
            beginning ??= connection.run(BEGIN_SNAPSHOT, {}, "execute");
            await beginning;
            return connection.run(statement, parameters, "rows");
          },
        });
      } finally {
        if (beginning !== null) await endSnapshot(connection);
      }
    });
  }

  /** Lifecycle and queue counters, free of SQL and values. */
  public status(): DatabaseExecutorStatus {
    const writer = this.writerLane.status();
    const readers = this.readerLane.status();
    return {
      worker: {
        state: this.state,
        generation: 1,
        restarts: 0,
        pendingStatements: writer.running + readers.running,
        pid: null,
      },
      writer,
      readers,
      readerConnections: READER_CONNECTIONS,
      reroutedReads: 0,
    };
  }

  /** Lets the accepted jobs finish, then closes the connections. */
  public async close(): Promise<void> {
    this.state = "closing";
    const isDrained = await withDeadline(
      Promise.all([this.writerLane.drain(), this.readerLane.drain()]).then(
        () => true,
      ),
      DATABASE_EXECUTOR_LIMITS.drainTimeoutMs,
      () => false,
    );
    if (!isDrained) {
      this.writerLane.refuseWaiting();
      this.readerLane.refuseWaiting();
    }
    // The server rolls back what a job past the deadline left open.
    await withDeadline(
      this.pool.end(),
      DATABASE_EXECUTOR_LIMITS.closeTimeoutMs,
      () => undefined,
    );
    this.state = "closed";
  }

  private scheduleRead<Result>(
    work: (connection: PostgresConnection) => Promise<Result>,
  ): Promise<Result> {
    const context = currentDatabaseWork();
    return this.readerLane.schedule(
      (queueMs) => {
        recordDatabaseWaitMetrics(queueMs, 0);
        return this.withConnection("reader", work);
      },
      {
        workClass: context.workClass,
        budgetMs: DATABASE_EXECUTOR_LIMITS.readQueueBudgetMs,
        signal: context.signal,
      },
    );
  }

  private async withConnection<Result>(
    role: PostgresConnectionRole,
    work: (connection: PostgresConnection) => Promise<Result>,
  ): Promise<Result> {
    const connection = new PostgresConnection(await this.checkOut(), role);
    try {
      return await work(connection);
    } finally {
      connection.release();
    }
  }

  private async checkOut(): Promise<PoolClient> {
    try {
      return await this.pool.connect();
    } catch (error: unknown) {
      logEvent({
        level: "error",
        event: "database.connection.failed",
        component: "Database",
        message: "No PostgreSQL connection could be opened",
        error,
        metadata: { code: postgresErrorCode(error) },
      });
      // No statement was sent, so the caller may repeat the job.
      throw new DatabaseUnavailableError();
    }
  }
}

async function endSnapshot(connection: PostgresConnection): Promise<void> {
  try {
    await connection.run("ROLLBACK;", {}, "execute");
  } catch (error: unknown) {
    // The reads already answered; a failed end only costs the connection.
    logCaughtError("PostgresExecutor", error);
  }
}
