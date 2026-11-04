import { mkdir } from "node:fs/promises";
import path from "node:path";

import { shutdownProcess } from "@/backend/runtime/ProcessLifecycle";
import {
  recordDatabaseTransaction,
  withDatabaseLogMetrics,
} from "@/backend/logging/DatabaseLogMetrics";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";

import { DatabaseExecutor } from "./executor/DatabaseExecutor";
import { postgresErrorCode } from "./postgres/PostgresConnection";
import { PostgresExecutor } from "./postgres/PostgresExecutor";
import { DatabaseOutcomeUnknownError } from "./executor/DatabaseExecutorErrors";
import { currentReadScope, readScopeKey, statementKind } from "./ReadScope";
import {
  createMigrationChecksum,
  MigrationChecksumError,
  UnknownMigrationError,
} from "./Migration";
import { readTextColumn } from "./RowValue";
import { sqlForDialect } from "./DatabaseDialect";

import type {
  DatabaseExecutorStatus,
  WriterSession,
} from "./executor/DatabaseExecutor";
import type { DatabaseLogSummary } from "@/backend/logging/DatabaseLogMetrics";
import type { DatabaseDialect, DialectSql } from "./DatabaseDialect";
import type { DatabaseEngine } from "./DatabaseEngine";
import type { Migration } from "./Migration";
import type { ReadScope } from "./ReadScope";

/** A single column value as returned by DuckDB. */
export type DatabaseValue = string | number | bigint | Buffer | null;

/** Named values bound to a parameterized statement. */
export type SqlParameters = Readonly<
  Record<string, string | number | bigint | boolean | Buffer | null>
>;

/**
 * Tells whether an error means a UNIQUE or PRIMARY KEY constraint rejected a
 * value of the given column.
 *
 * @param error - Error thrown by a statement.
 * @param column - Column name of the constraint.
 * @returns Whether `error` is such a violation.
 *
 * @remarks
 * DuckDB reports the offending key as `Duplicate key "column: value"`, so the
 * message is the only place that names the column. PostgreSQL names it in the
 * detail of the error, as `Key (column)=(value)`, or `Key (column, other)=…`
 * for a key of several columns.
 */
export function isUniqueViolationOn(error: unknown, column: string): boolean {
  if (!(error instanceof Error)) return false;
  if (error.message.includes(`Duplicate key "${column}: `)) return true;
  return (
    "code" in error &&
    error.code === POSTGRES_UNIQUE_VIOLATION &&
    "detail" in error &&
    typeof error.detail === "string" &&
    (error.detail.startsWith(`Key (${column})=`) ||
      error.detail.startsWith(`Key (${column}, `))
  );
}

/** SQLSTATE of a rejected duplicate in a UNIQUE or PRIMARY KEY constraint. */
const POSTGRES_UNIQUE_VIOLATION = "23505";

/** Database path that opens a private in-memory database. */
export const IN_MEMORY_DATABASE_PATH = ":memory:";

/** PostgreSQL keeps its own table, so a copied DuckDB table never counts as applied. */
const MIGRATIONS_TABLE: Readonly<Record<DatabaseDialect, string>> = {
  duckdb: "schema_migrations",
  postgres: "postgres_schema_migrations",
};

/** PostgreSQL has no `utc_now()` yet when this runs: its first migration creates it. */
const CREATE_MIGRATIONS_TABLE: DialectSql = {
  duckdb: `
    CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT utc_now()
    );
  `,
  postgres: `
    CREATE TABLE IF NOT EXISTS postgres_schema_migrations (
        name TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
    );
  `,
};

/** Statement access that is bound to one open transaction. */
export interface DatabaseTransaction {
  /** Schedules a file effect only after the outermost transaction committed. */
  readonly onCommit?: (effect: () => Promise<void>) => void;
  /** Restores prepared files when the outermost transaction rolls back. */
  readonly onRollback?: (effect: () => Promise<void>) => void;
  /** Runs a statement without returning rows. */
  execute(statement: string, parameters?: SqlParameters): Promise<void>;
  /** Runs a query and returns its rows as positional column values. */
  query(
    statement: string,
    parameters?: SqlParameters,
  ): Promise<readonly DatabaseValue[][]>;
}

/**
 * Provides the central server-side database access.
 *
 * @remarks
 * DuckDB allows one writing process per database file. A single worker
 * process owns the instance (see `executor/DatabaseWorker.ts` and
 * `docs/DatabaseExecutor.md`): changes and transactions queue for its one
 * writer connection, so a transaction keeps the writer until it finished and
 * no other request can join it. Reads run on reader connections of the same
 * instance and see the last committed state, so a long write never holds
 * them back. {@link Database.connect} opens PostgreSQL instead, behind the same
 * methods (see `postgres/PostgresExecutor.ts`); DuckDB stays the default until
 * the switch.
 */
export class Database {
  private readonly executor: DatabaseEngine;
  private readonly engineDialect: DatabaseDialect;
  /** Counts finished writes, so a read scope knows when its answers ended. */
  private writes = 0;

  private constructor(executor: DatabaseEngine, dialect: DatabaseDialect) {
    this.executor = executor;
    this.engineDialect = dialect;
  }

  /**
   * Opens a DuckDB database, creating its parent directory when needed.
   *
   * @param databasePath - File system path, or {@link IN_MEMORY_DATABASE_PATH}.
   * @returns An open database.
   */
  public static async create(databasePath: string): Promise<Database> {
    return withDatabaseLogMetrics(async (metrics) => {
      if (databasePath !== IN_MEMORY_DATABASE_PATH) {
        await mkdir(path.dirname(databasePath), { recursive: true });
      }

      const executor = await DatabaseExecutor.start(
        databasePath,
        requireUsableDatabase,
      );
      logEvent({
        level: "info",
        event: "database.opened",
        component: "Database",
        message: "DuckDB connection initialized",
        metadata: { ...metrics.finish() },
      });

      return new Database(executor, "duckdb");
    });
  }

  /**
   * Opens a PostgreSQL database through a connection pool.
   *
   * @param databaseUrl - The connection URL; it never reaches a log line.
   * @returns An open database.
   * @throws The error of the driver or server when no connection opens.
   */
  public static async connect(databaseUrl: string): Promise<Database> {
    return withDatabaseLogMetrics(async (metrics) => {
      const executor = await startPostgres(databaseUrl);
      logEvent({
        level: "info",
        event: "database.opened",
        component: "Database",
        message: "PostgreSQL connection pool initialized",
        metadata: { ...metrics.finish() },
      });

      return new Database(executor, "postgres");
    });
  }

  /** The SQL dialect of this database, see `DatabaseDialect.ts`. */
  public get dialect(): DatabaseDialect {
    return this.engineDialect;
  }

  /**
   * Checkpoints pending WAL changes with a live client before releasing the database.
   *
   * @remarks
   * DuckDB 1.5.5 can otherwise persist stale secondary indexes in its implicit
   * shutdown checkpoint. The worker checkpoints with its writer connection
   * after every accepted change finished or, past the drain limit of the
   * executor, was rolled back. A failed checkpoint is surfaced; it never implies
   * cleanup.
   */
  public async close(): Promise<void> {
    await this.executor.close();
    logEvent({
      level: "info",
      event: "database.closed",
      component: "Database",
      message:
        this.engineDialect === "duckdb"
          ? "DuckDB connection closed"
          : "PostgreSQL connection pool closed",
    });
  }

  /** Worker lifecycle and queue counters for `/health`; free of SQL and values. */
  public executorStatus(): DatabaseExecutorStatus {
    return this.executor.status();
  }

  /**
   * Applies every migration that the database has not seen yet.
   *
   * @param migrations - All known migrations of this dialect, see
   * `migrationsFor`; they run in name order.
   * @throws {MigrationChecksumError} When an applied migration was edited.
   * @throws {UnknownMigrationError} When the database is ahead of the code.
   * @throws When a migration fails; it is rolled back completely.
   */
  public async migrate(migrations: readonly Migration[]): Promise<void> {
    return withDatabaseLogMetrics(async (metrics) => {
      await this.execute(
        sqlForDialect(this.engineDialect, CREATE_MIGRATIONS_TABLE),
      );

      const appliedChecksums = await this.readAppliedChecksums();
      const knownNames = new Set(migrations.map((migration) => migration.name));

      for (const appliedName of appliedChecksums.keys()) {
        if (!knownNames.has(appliedName)) {
          throw new UnknownMigrationError(appliedName);
        }
      }

      const orderedMigrations = [...migrations].sort((first, second) =>
        first.name.localeCompare(second.name),
      );
      let appliedCount = 0;

      for (const migration of orderedMigrations) {
        const checksum = createMigrationChecksum(migration.sql);
        const appliedChecksum = appliedChecksums.get(migration.name);

        if (appliedChecksum === undefined) {
          await this.applyMigration(migration, checksum);
          appliedCount += 1;
        } else if (appliedChecksum !== checksum) {
          throw new MigrationChecksumError(migration.name);
        }
      }

      // DuckDB cannot replay an ALTER TABLE on a table whose defaults call
      // utc_now() from the write-ahead log; writing the schema change into the
      // file right away keeps a later unclean stop from leaving such a log.
      if (appliedCount > 0 && this.engineDialect === "duckdb") {
        await this.execute("CHECKPOINT;");
      }
      logEvent({
        level: "info",
        event: "database.migrations.completed",
        component: "Database",
        message: "Database migrations verified",
        metadata: { count: appliedCount, ...metrics.finish() },
      });
    });
  }

  /**
   * Runs a persistence statement without returning rows.
   *
   * @param statement - SQL owned by a repository. Without parameters it may
   * hold several statements, which migrations rely on.
   * @param parameters - Values bound to the statement placeholders.
   */
  public async execute(
    statement: string,
    parameters: SqlParameters = {},
  ): Promise<void> {
    await this.write((writer) => writer.run(statement, parameters, "execute"));
  }

  /**
   * Runs a query and returns its rows as raw positional column values.
   *
   * @param statement - SQL owned by a repository.
   * @param parameters - Values bound to the statement placeholders.
   * @returns Rows in query column order.
   */
  public async query(
    statement: string,
    parameters: SqlParameters = {},
  ): Promise<readonly DatabaseValue[][]> {
    const kind = statementKind(statement);
    if (kind === "write")
      return this.write((writer) => writer.run(statement, parameters, "rows"));
    const scope = kind === "repeatable" ? currentReadScope() : undefined;
    const key = scope ? readScopeKey(statement, parameters) : null;
    if (!scope || key === null)
      return this.executor.read(statement, parameters);
    // Counted before the read starts: a write in between only costs the answer its reuse.
    const epoch = this.writes;
    const known = scope.find(key, epoch);
    if (known) return known;
    const rows = await this.executor.read(statement, parameters);
    scope.store(key, epoch, rows);
    return rows;
  }

  /**
   * Runs several statements atomically.
   *
   * @param work - Receives statement access bound to the transaction. It
   * must not call the database itself, because the database is busy until
   * the transaction ends.
   * @returns Whatever `work` returns once the transaction committed.
   * @throws Whatever `work` throws, after the transaction was rolled back.
   */
  public async transaction<Result>(
    work: (transaction: DatabaseTransaction) => Promise<Result>,
  ): Promise<Result> {
    const scope = currentReadScope();
    return this.executor.write(async (writer) => {
      const progress: TransactionProgress = {
        scope,
        epoch: this.writes,
        hasWritten: false,
      };
      try {
        return await runInTransaction(writer, work, progress);
      } finally {
        // A transaction that only read leaves every remembered answer valid.
        if (progress.hasWritten) this.writes += 1;
      }
    });
  }

  /**
   * Runs several reads on one consistent snapshot without the writer.
   *
   * @param work - Receives read access bound to a read-only transaction on a
   * reader connection; `execute` and changing queries are refused. It must
   * not call the database itself.
   * @returns Whatever `work` returns.
   *
   * @remarks
   * The snapshot is the last committed state when the first read ran; an
   * open or slow write neither holds it back nor shows in it. Code that
   * reads and then writes on what it read uses {@link transaction}, which
   * keeps both on the writer.
   */
  public async readTransaction<Result>(
    work: (transaction: DatabaseTransaction) => Promise<Result>,
  ): Promise<Result> {
    const scope = currentReadScope();
    return this.executor.readSession((session) => {
      const epoch = this.writes;
      return work({
        execute: () =>
          Promise.reject(new Error("A read transaction cannot change data.")),
        query: async (statement, parameters = {}) => {
          const kind = statementKind(statement);
          if (kind === "write")
            throw new Error("A read transaction cannot change data.");
          const key =
            scope && kind === "repeatable"
              ? readScopeKey(statement, parameters)
              : null;
          const known = scope && key !== null ? scope.find(key, epoch) : null;
          if (known) return known;
          const rows = await session.query(statement, parameters);
          if (scope && key !== null) scope.store(key, epoch, rows);
          return rows;
        },
      });
    });
  }

  /** Runs a change as one writer job and counts it before the next job starts. */
  private write<Result>(
    work: (writer: WriterSession) => Promise<Result>,
  ): Promise<Result> {
    return this.executor.write(async (writer) => {
      try {
        return await work(writer);
      } finally {
        this.writes += 1;
      }
    });
  }

  private async readAppliedChecksums(): Promise<ReadonlyMap<string, string>> {
    const rows = await this.query(
      `SELECT name, checksum FROM ${MIGRATIONS_TABLE[this.engineDialect]} ORDER BY name;`,
    );

    return new Map(
      rows.map(
        (row) =>
          [
            readTextColumn(row, 0, "name"),
            readTextColumn(row, 1, "checksum"),
          ] as const,
      ),
    );
  }

  private async applyMigration(
    migration: Migration,
    checksum: string,
  ): Promise<void> {
    try {
      await this.transaction(async (transaction) => {
        await transaction.execute(migration.sql);
        await transaction.execute(
          `
            INSERT INTO ${MIGRATIONS_TABLE[this.engineDialect]} (
                name,
                checksum
            )
            VALUES (
                $name,
                $checksum
            );
          `,
          { checksum, name: migration.name },
        );
      });
    } catch (error: unknown) {
      logCaughtError("Database", error);

      throw new Error(
        `Failed to apply database migration "${migration.name}".`,
        {
          cause: error,
        },
      );
    }
  }
}

async function startPostgres(databaseUrl: string): Promise<PostgresExecutor> {
  try {
    return await PostgresExecutor.start(databaseUrl);
  } catch (error: unknown) {
    logEvent({
      level: "error",
      event: "database.open_failed",
      component: "Database",
      message: "The PostgreSQL database could not be opened",
      error,
      metadata: { code: postgresErrorCode(error) },
    });

    throw error;
  }
}

/** What a transaction has done so far, and the read scope its reads may use. */
interface TransactionProgress {
  readonly scope: ReadScope | undefined;
  /** The number of writes the database had seen when the transaction took the queue. */
  readonly epoch: number;
  hasWritten: boolean;
}

/**
 * Opens the transaction on its first statement that cannot be answered from the read scope.
 *
 * @remarks
 * The transaction holds the queue, so nothing runs between its start and its
 * first statement; beginning it later changes no row it sees. A transaction
 * whose reads were all remembered never touches the database.
 */
function lazyTransaction(
  writer: WriterSession,
  progress: TransactionProgress,
): {
  readonly access: Pick<DatabaseTransaction, "execute" | "query">;
  readonly isOpen: () => boolean;
} {
  let isOpen = false;
  async function open(): Promise<void> {
    if (isOpen) return;
    await writer.run("BEGIN TRANSACTION;", {}, "execute");
    isOpen = true;
  }
  return {
    isOpen: () => isOpen,
    access: {
      execute: async (statement, parameters = {}) => {
        await open();
        progress.hasWritten = true;
        await writer.run(statement, parameters, "execute");
      },
      query: async (statement, parameters = {}) => {
        const kind = statementKind(statement);
        const scope =
          kind === "repeatable" && !progress.hasWritten
            ? progress.scope
            : undefined;
        const key = scope ? readScopeKey(statement, parameters) : null;
        const known =
          scope && key !== null ? scope.find(key, progress.epoch) : null;
        if (known) return known;
        await open();
        if (kind === "write") progress.hasWritten = true;
        const rows = await writer.run(statement, parameters, "rows");
        if (scope && key !== null) scope.store(key, progress.epoch, rows);
        return rows;
      },
    },
  };
}

async function runInTransaction<Result>(
  writer: WriterSession,
  work: (transaction: DatabaseTransaction) => Promise<Result>,
  progress: TransactionProgress,
): Promise<Result> {
  return withDatabaseLogMetrics(async (metrics) => {
    const { access, isOpen } = lazyTransaction(writer, progress);
    let isCommitting = false;
    const commitEffects: (() => Promise<void>)[] = [];
    const rollbackEffects: (() => Promise<void>)[] = [];

    try {
      const result = await work({
        onCommit: (effect) => {
          commitEffects.push(effect);
        },
        onRollback: (effect) => {
          rollbackEffects.push(effect);
        },
        ...access,
      });

      isCommitting = true;
      if (isOpen()) await writer.run("COMMIT;", {}, "execute");
      isCommitting = false;
      await finishFileEffects(commitEffects);
      const hasParent = recordDatabaseTransaction("committed");
      const summary = metrics.finish();
      if (!hasParent)
        logEvent({
          level: "debug",
          event: "database.transaction.committed",
          component: "Database",
          message: "Database transaction committed",
          metadata: { ...summary },
        });

      return result;
    } catch (error: unknown) {
      logCaughtError("Database", error);

      if (isCommitting && error instanceof DatabaseOutcomeUnknownError) {
        reportUnknownCommit(error, metrics.finish());
        throw error;
      }
      if (isOpen()) await rollBack(writer);
      await finishFileEffects(rollbackEffects.reverse());
      recordDatabaseTransaction("rolled_back");
      logEvent({
        level: "warn",
        event: "database.transaction.rolled_back",
        component: "Database",
        message: "Database transaction rolled back",
        error,
        metadata: { ...metrics.finish() },
      });

      throw error;
    }
  });
}

async function finishFileEffects(
  effects: readonly (() => Promise<void>)[],
): Promise<void> {
  for (const effect of effects) {
    try {
      await effect();
    } catch (error: unknown) {
      // A completed commit cannot be undone by a failed file cleanup; maintenance retries leftovers.
      logCaughtError("DatabaseFileEffects", error);
    }
  }
}

/**
 * Records a transaction whose COMMIT the worker may or may not have
 * finished before it ended.
 *
 * @remarks
 * Neither the commit nor the rollback file effects run: either could
 * destroy files of the state that actually holds. Callers reconcile through
 * their revisions and operation IDs; nothing repeats the change.
 */
function reportUnknownCommit(
  error: DatabaseOutcomeUnknownError,
  summary: DatabaseLogSummary,
): void {
  recordDatabaseTransaction("rolled_back");
  logEvent({
    level: "error",
    event: "database.transaction.outcome_unknown",
    component: "Database",
    message: "Database worker ended during COMMIT; the outcome is unknown",
    error,
    metadata: { ...summary },
  });
}

/**
 * Rolls back an open transaction without hiding the error that ended it.
 *
 * @remarks
 * When the worker ended, DuckDB already discarded the uncommitted changes
 * and the ROLLBACK cannot reach it; that failure is logged only.
 */
async function rollBack(writer: WriterSession): Promise<void> {
  try {
    await writer.run("ROLLBACK;", {}, "execute");
  } catch (error: unknown) {
    logCaughtError("Database", error);
  }
}

/**
 * Ends the process when DuckDB invalidated the database.
 *
 * @remarks
 * DuckDB refuses every later statement and must be opened by a new process.
 * Staying alive would leave Pages answering without a usable database; the
 * explicit fatal exit lets the service manager start it again, and the
 * startup recovery records interrupted work as resumable.
 */
function requireUsableDatabase(error: Error): void {
  void shutdownProcess(1, "database_invalidated", error);
}
