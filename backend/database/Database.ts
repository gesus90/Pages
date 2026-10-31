import { mkdir } from "node:fs/promises";
import path from "node:path";

import { DuckDBBlobValue, DuckDBInstance } from "@duckdb/node-api";

import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { shutdownProcess } from "@/backend/runtime/ProcessLifecycle";
import {
  recordDatabaseTransaction,
  withDatabaseLogMetrics,
} from "@/backend/logging/DatabaseLogMetrics";
import {
  logCaughtError,
  logDiagnostic,
  logEvent,
} from "@/backend/logging/Logger";

import { recordDatabaseQuery } from "./DatabaseStats";
import { currentReadScope, readScopeKey, statementKind } from "./ReadScope";
import {
  createMigrationChecksum,
  MigrationChecksumError,
  UnknownMigrationError,
} from "./Migration";
import { readTextColumn } from "./RowValue";

import type { DuckDBConnection, DuckDBValue } from "@duckdb/node-api";
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
 * message is the only place that names the column.
 */
export function isUniqueViolationOn(error: unknown, column: string): boolean {
  return (
    error instanceof Error &&
    error.message.includes(`Duplicate key "${column}: `)
  );
}

/** Database path that opens a private in-memory database. */
export const IN_MEMORY_DATABASE_PATH = ":memory:";

/**
 * Session setup every connection runs first.
 *
 * - `utc_now()` is the current UTC time and `utc_after(time_shift)` the time
 *   `time_shift` (an interval) from now, both as `YYYY-MM-DD HH:MM:SS` text,
 *   the format all timestamp columns store.
 * - NULL values sort first in ascending and last in descending order, which
 *   is the order the `ORDER BY` clauses of the repositories rely on.
 */
const CONNECTION_SETUP = `
  SET default_null_order = 'nulls_first_on_asc_last_on_desc';
  CREATE OR REPLACE MACRO utc_after(time_shift) AS
      strftime((now() AT TIME ZONE 'UTC') + time_shift, '%Y-%m-%d %H:%M:%S');
  CREATE OR REPLACE MACRO utc_now() AS
      utc_after(INTERVAL 0 DAY);
`;

const CREATE_MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT utc_now()
  );
`;

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
 * Provides the central server-side DuckDB connection.
 *
 * @remarks
 * DuckDB allows one writing process per database file and runs one
 * statement at a time on a connection. Statements of concurrent requests
 * are therefore queued and executed in call order, and a transaction holds
 * the queue until it finished so no other request can join it.
 */
export class Database {
  private readonly instance: DuckDBInstance;
  private readonly connection: DuckDBConnection;
  private readonly queue = new SerialQueue();
  /** Counts finished writes, so a read scope knows when its answers ended. */
  private writes = 0;

  private constructor(instance: DuckDBInstance, connection: DuckDBConnection) {
    this.instance = instance;
    this.connection = connection;
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

      const instance = await openInstance(databasePath);
      const connection = await instance.connect();

      await runStatement(connection, CONNECTION_SETUP, {});
      logEvent({
        level: "info",
        event: "database.opened",
        component: "Database",
        message: "DuckDB connection initialized",
        metadata: { ...metrics.finish() },
      });

      return new Database(instance, connection);
    });
  }

  /**
   * Checkpoints pending WAL changes with a live client before releasing the database.
   *
   * @remarks
   * DuckDB 1.5.5 can otherwise persist stale secondary indexes in its implicit
   * shutdown checkpoint. A failed checkpoint is surfaced; it never implies cleanup.
   */
  public async close(): Promise<void> {
    try {
      // DuckDB 1.5.5 can serialize stale buffered ART indexes during its context-free
      // shutdown checkpoint after WAL replay. Checkpoint with this live connection.
      await this.queue.run(() =>
        runStatement(this.connection, "CHECKPOINT;", {}),
      );
    } finally {
      this.connection.closeSync();
      this.instance.closeSync();
    }
    logEvent({
      level: "info",
      event: "database.closed",
      component: "Database",
      message: "DuckDB connection closed",
    });
  }

  /**
   * Applies every migration that the database has not seen yet.
   *
   * @param migrations - All known migrations; they run in name order.
   * @throws {MigrationChecksumError} When an applied migration was edited.
   * @throws {UnknownMigrationError} When the database is ahead of the code.
   * @throws When a migration fails; it is rolled back completely.
   */
  public async migrate(migrations: readonly Migration[]): Promise<void> {
    return withDatabaseLogMetrics(async (metrics) => {
      await this.execute(CREATE_MIGRATIONS_TABLE);

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
      if (appliedCount > 0) {
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
    await this.write(() =>
      runStatement(this.connection, statement, parameters),
    );
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
      return this.write(() => readRows(this.connection, statement, parameters));
    const scope = kind === "repeatable" ? currentReadScope() : undefined;
    const key = scope ? readScopeKey(statement, parameters) : null;
    if (!scope || key === null)
      return this.queue.run(() =>
        readRows(this.connection, statement, parameters),
      );
    // Counted before the read is queued: a write in between only costs the answer its reuse.
    const epoch = this.writes;
    const known = scope.find(key, epoch);
    if (known) return known;
    const rows = await this.queue.run(() =>
      readRows(this.connection, statement, parameters),
    );
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
    return this.queue.run(async () => {
      const progress: TransactionProgress = {
        scope,
        epoch: this.writes,
        hasWritten: false,
      };
      try {
        return await runInTransaction(this.connection, work, progress);
      } finally {
        // A transaction that only read leaves every remembered answer valid.
        if (progress.hasWritten) this.writes += 1;
      }
    });
  }

  /** Runs a change inside the queue and counts it before the next statement starts. */
  private write<Result>(work: () => Promise<Result>): Promise<Result> {
    return this.queue.run(async () => {
      try {
        return await work();
      } finally {
        this.writes += 1;
      }
    });
  }

  private async readAppliedChecksums(): Promise<ReadonlyMap<string, string>> {
    const rows = await this.query(
      "SELECT name, checksum FROM schema_migrations ORDER BY name;",
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
            INSERT INTO schema_migrations (
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

/** Text DuckDB reports when it cannot replay the write-ahead log of a file. */
const WAL_REPLAY_FAILURE = "Failure while replaying WAL";

/**
 * Opens a DuckDB instance, replaying a write-ahead log that DuckDB cannot
 * replay while it opens the file as its main database.
 *
 * @param databasePath - File system path, or {@link IN_MEMORY_DATABASE_PATH}.
 * @returns The open instance.
 * @throws Every other failure to open the database.
 *
 * @remarks
 * DuckDB 1.5 fails to replay an `ALTER TABLE` of a table whose defaults call
 * a macro such as `utc_now()`, because no default database exists yet while
 * the main database loads. Attached to an in-memory instance the same log
 * replays; a checkpoint then writes it into the file, and the file opens.
 */
async function openInstance(databasePath: string): Promise<DuckDBInstance> {
  try {
    return await DuckDBInstance.create(databasePath);
  } catch (error: unknown) {
    logCaughtError("Database", error);

    if (!String(error).includes(WAL_REPLAY_FAILURE)) {
      throw error;
    }

    await replayWriteAheadLog(databasePath);
    logDiagnostic(
      "Database",
      "warn",
      "[pages] Replayed the write-ahead log through an attached database.",
    );

    return DuckDBInstance.create(databasePath);
  }
}

async function replayWriteAheadLog(databasePath: string): Promise<void> {
  const memory = await DuckDBInstance.create(IN_MEMORY_DATABASE_PATH);
  const connection = await memory.connect();

  try {
    // ATTACH takes no parameters; the path comes from the server
    // configuration and is quoted as a string literal.
    const literal = `'${databasePath.replaceAll("'", "''")}'`;

    await connection.run(
      `ATTACH ${literal} AS recovered; CHECKPOINT recovered; DETACH recovered;`,
    );
  } finally {
    connection.closeSync();
    memory.closeSync();
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
  connection: DuckDBConnection,
  progress: TransactionProgress,
): {
  readonly access: Pick<DatabaseTransaction, "execute" | "query">;
  readonly isOpen: () => boolean;
} {
  let isOpen = false;
  async function open(): Promise<void> {
    if (isOpen) return;
    await runStatement(connection, "BEGIN TRANSACTION;", {});
    isOpen = true;
  }
  return {
    isOpen: () => isOpen,
    access: {
      execute: async (statement, parameters = {}) => {
        await open();
        progress.hasWritten = true;
        await runStatement(connection, statement, parameters);
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
        const rows = await readRows(connection, statement, parameters);
        if (scope && key !== null) scope.store(key, progress.epoch, rows);
        return rows;
      },
    },
  };
}

async function runInTransaction<Result>(
  connection: DuckDBConnection,
  work: (transaction: DatabaseTransaction) => Promise<Result>,
  progress: TransactionProgress,
): Promise<Result> {
  return withDatabaseLogMetrics(async (metrics) => {
    const { access, isOpen } = lazyTransaction(connection, progress);
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

      if (isOpen()) await runStatement(connection, "COMMIT;", {});
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

      if (isOpen()) await runStatement(connection, "ROLLBACK;", {});
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

/** Text DuckDB reports for every statement once a fatal error invalidated the open database. */
const DATABASE_INVALIDATED = "database has been invalidated";

/**
 * Ends the process when DuckDB invalidated the database.
 *
 * @remarks
 * DuckDB refuses every later statement and must be opened by a new process.
 * Staying alive would leave Pages answering without a usable database; the
 * explicit fatal exit lets the service manager start it again, and the
 * startup recovery records interrupted work as resumable.
 */
function requireUsableDatabase(error: unknown): void {
  if (error instanceof Error && error.message.includes(DATABASE_INVALIDATED))
    void shutdownProcess(1, "database_invalidated", error);
}

async function runStatement(
  connection: DuckDBConnection,
  statement: string,
  parameters: SqlParameters,
): Promise<void> {
  const startedAt = performance.now();

  try {
    await connection.run(statement, toBindings(parameters));
  } catch (error: unknown) {
    logEvent({
      level: "error",
      event: "database.statement.failed",
      component: "Database",
      message: "Database statement failed",
      error,
      metadata: { parameterCount: Object.keys(parameters).length },
    });
    requireUsableDatabase(error);
    throw error;
  } finally {
    recordDatabaseQuery(statement, performance.now() - startedAt);
  }
}

async function readRows(
  connection: DuckDBConnection,
  statement: string,
  parameters: SqlParameters,
): Promise<readonly DatabaseValue[][]> {
  const startedAt = performance.now();

  try {
    const reader = await connection.runAndReadAll(
      statement,
      toBindings(parameters),
    );

    return reader.getRows().map((row) => row.map(toDatabaseValue));
  } catch (error: unknown) {
    logEvent({
      level: "error",
      event: "database.query.failed",
      component: "Database",
      message: "Database query failed",
      error,
      metadata: { parameterCount: Object.keys(parameters).length },
    });
    requireUsableDatabase(error);
    throw error;
  } finally {
    recordDatabaseQuery(statement, performance.now() - startedAt);
  }
}

/**
 * Converts repository parameters to DuckDB values.
 *
 * @returns `undefined` without parameters, because DuckDB only runs several
 * statements in one call when nothing is bound.
 */
function toBindings(
  parameters: SqlParameters,
): Record<string, DuckDBValue> | undefined {
  const entries = Object.entries(parameters);

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(
    entries.map(([name, value]) => [name, toBinding(value)]),
  );
}

function toBinding(value: SqlParameters[string]): DuckDBValue {
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  if (Buffer.isBuffer(value)) {
    return new DuckDBBlobValue(value);
  }

  return value;
}

/**
 * Converts a DuckDB value to the value types repositories read.
 *
 * @remarks
 * `COUNT` and `SUM` return `BIGINT`; those values become plain numbers while
 * they fit, so repositories read them like any other integer.
 */
function toDatabaseValue(value: DuckDBValue): DatabaseValue {
  if (value === null || typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "bigint") {
    return Number.isSafeInteger(Number(value)) ? Number(value) : value;
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  if (value instanceof DuckDBBlobValue) {
    return Buffer.from(value.bytes);
  }

  throw new Error("Database returned a value of an unsupported type.");
}
