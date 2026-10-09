import { mkdir } from "node:fs/promises";
import path from "node:path";

import { DuckDBBlobValue, DuckDBInstance } from "@duckdb/node-api";

import { SerialQueue } from "@/backend/concurrency/SerialQueue";

import { recordDatabaseQuery } from "./DatabaseStats";
import {
  createMigrationChecksum,
  MigrationChecksumError,
  UnknownMigrationError,
} from "./Migration";
import { readTextColumn } from "./RowValue";

import type { DuckDBConnection, DuckDBValue } from "@duckdb/node-api";
import type { Migration } from "./Migration";

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
 * - NULL values sort first in ascending and last in descending order, like
 *   they did in SQLite, so existing `ORDER BY` clauses keep their meaning.
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
    if (databasePath !== IN_MEMORY_DATABASE_PATH) {
      await mkdir(path.dirname(databasePath), { recursive: true });
    }

    const instance = await openInstance(databasePath);
    const connection = await instance.connect();

    await connection.run(CONNECTION_SETUP);

    return new Database(instance, connection);
  }

  /** Waits for queued statements, then releases the database. */
  public async close(): Promise<void> {
    await this.queue.idle();

    this.connection.closeSync();
    this.instance.closeSync();
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
    await this.queue.run(() =>
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
    return this.queue.run(() =>
      readRows(this.connection, statement, parameters),
    );
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
    return this.queue.run(() => runInTransaction(this.connection, work));
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
    if (!String(error).includes(WAL_REPLAY_FAILURE)) {
      throw error;
    }

    await replayWriteAheadLog(databasePath);
    console.warn(
      `[pages] Replayed the write-ahead log of ${databasePath} through an attached database.`,
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

async function runInTransaction<Result>(
  connection: DuckDBConnection,
  work: (transaction: DatabaseTransaction) => Promise<Result>,
): Promise<Result> {
  await connection.run("BEGIN TRANSACTION;");

  try {
    const result = await work({
      execute: (statement, parameters = {}) =>
        runStatement(connection, statement, parameters),
      query: (statement, parameters = {}) =>
        readRows(connection, statement, parameters),
    });

    await connection.run("COMMIT;");

    return result;
  } catch (error: unknown) {
    await connection.run("ROLLBACK;");

    throw error;
  }
}

async function runStatement(
  connection: DuckDBConnection,
  statement: string,
  parameters: SqlParameters,
): Promise<void> {
  const startedAt = performance.now();

  try {
    await connection.run(statement, toBindings(parameters));
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
