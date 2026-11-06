import {
  recordDatabaseTransaction,
  withDatabaseLogMetrics,
} from "@/backend/logging/DatabaseLogMetrics";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import { AgentPayloadFileStore } from "@/backend/storage/AgentPayloadFileStore";

import { postgresErrorCode } from "./postgres/PostgresConnection";
import { PostgresExecutor } from "./postgres/PostgresExecutor";
import { requireByteOrderedDatabase } from "./postgres/PostgresLocale";
import { DatabaseOutcomeUnknownError } from "./executor/DatabaseExecutorErrors";
import { currentReadScope, readScopeKey, statementKind } from "./ReadScope";
import { CallTransaction, currentCall, runInCall } from "./CallTransaction";
import {
  createMigrationChecksum,
  MigrationChecksumError,
  UnknownMigrationError,
} from "./Migration";
import { readTextColumn } from "./RowValue";

import type {
  DatabaseExecutorStatus,
  WriterSession,
} from "./DatabaseExecutorTypes";
import type { DatabaseLogSummary } from "@/backend/logging/DatabaseLogMetrics";
import type { DatabaseEngine } from "./DatabaseEngine";
import type { Migration } from "./Migration";
import type { CallTransactionHost } from "./CallTransaction";
import type { ReadScope } from "./ReadScope";

/** A single column value returned by the database. */
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
 * PostgreSQL names the rejected key in the
 * detail of the error, as `Key (column)=(value)`, or `Key (column, other)=…`
 * for a key of several columns.
 */
export function isUniqueViolationOn(error: unknown, column: string): boolean {
  if (!(error instanceof Error)) return false;
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

const MIGRATIONS_TABLE = "postgres_schema_migrations";

const CREATE_MIGRATIONS_TABLE = `
    CREATE TABLE IF NOT EXISTS postgres_schema_migrations (
        name TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
    );
`;

/** Statement access that is bound to one open transaction. */
export interface DatabaseTransaction {
  /** Private payload storage shared by every transaction of this instance. */
  readonly agentFiles?: AgentPayloadFileStore;
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

/** What a call hands to its finishing step, inside its still open transaction. */
export interface CallCompletion<Result> {
  readonly transaction: DatabaseTransaction;
  readonly result: Result;
  /** Whether the call runs inside another call, whose commit it waits for. */
  readonly isNested: boolean;
}

/** When a call takes the writer. */
export interface CallOptions {
  /**
   * Opens the transaction at the first write instead of at the start; reads
   * before it, and work such as receiving an upload, do not hold the writer.
   */
  readonly opensAtFirstWrite?: boolean;
}

/** Provides central server-side access through the PostgreSQL pool. */
export class Database {
  /** Instance-owned file storage; no caller supplies a storage path. */
  public readonly agentFiles?: AgentPayloadFileStore;
  private readonly executor: DatabaseEngine;
  /** Counts finished writes, so a read scope knows when its answers ended. */
  private writes = 0;
  private canCollectPayloads = false;
  /** Opens the writer transaction of a call without routing it into the call. */
  private readonly callHost: CallTransactionHost = {
    runTransaction: (work) => this.ownTransaction(work),
  };

  private constructor(executor: DatabaseEngine, directory?: string) {
    this.executor = executor;
    this.agentFiles =
      directory === undefined
        ? undefined
        : new AgentPayloadFileStore(directory);
  }

  /**
   * Opens a PostgreSQL database through a connection pool.
   *
   * @param databaseUrl - The connection URL; it never reaches a log line.
   * @param directory - Configured instance data directory, required for new agent payloads.
   * @returns An open database.
   * @throws The error of the driver or server when no connection opens.
   * @throws {PostgresLocaleError} When the database sorts text differently from DuckDB.
   */
  public static async connect(
    databaseUrl: string,
    directory?: string,
  ): Promise<Database> {
    return withDatabaseLogMetrics(async (metrics) => {
      const executor = await startPostgres(databaseUrl);
      logEvent({
        level: "info",
        event: "database.opened",
        component: "Database",
        message: "PostgreSQL connection pool initialized",
        metadata: { ...metrics.finish() },
      });

      return new Database(executor, directory);
    });
  }

  /** Releases the connection pool after accepted work finishes. */
  public async close(): Promise<void> {
    await this.executor.close();
    logEvent({
      level: "info",
      event: "database.closed",
      component: "Database",
      message: "PostgreSQL connection pool closed",
    });
  }

  /** Worker lifecycle and queue counters for `/health`; free of SQL and values. */
  public executorStatus(): DatabaseExecutorStatus {
    return this.executor.status();
  }

  /**
   * Applies every migration that the database has not seen yet.
   *
   * @param migrations - All known PostgreSQL migrations; they run in name order.
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

      logEvent({
        level: "info",
        event: "database.migrations.completed",
        component: "Database",
        message: "Database migrations verified",
        metadata: { count: appliedCount, ...metrics.finish() },
      });
      this.canCollectPayloads = knownNames.has("011_agent_payload_files.sql");
      if (this.canCollectPayloads) await this.agentFiles?.collectGarbage(this);
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
    const call = currentCall(this.callHost);
    if (call) {
      await (await call.open()).execute(statement, parameters);
      return;
    }
    await this.writeStatement(statement, parameters, "execute");
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
    const call = currentCall(this.callHost);
    if (call && (call.isOpen || kind === "write"))
      return (await call.open()).query(statement, parameters);
    if (kind === "write")
      return this.writeStatement(statement, parameters, "rows");
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
    const call = currentCall(this.callHost);
    if (call) return savepointTransaction(call, work);
    return this.ownTransaction(work);
  }

  /**
   * Runs a call as one transaction and finishes it before the commit.
   *
   * @param work - The call; its statements, nested transactions and reads
   * after the opening join the transaction.
   * @param finish - Runs in the open transaction after `work`, for example to
   * store the events of what `work` changed; it does not run when the call
   * never opened.
   * @param options - When the call takes the writer.
   * @returns Whatever `work` returns, once the call committed.
   * @throws Whatever `work` or `finish` throws, after the call rolled back.
   *
   * @remarks
   * A call inside another call joins it and commits with it. Effects kept
   * with `afterCallCommit` run after the commit and are dropped on a
   * rollback.
   */
  public async runCall<Result>(
    work: () => Promise<Result>,
    finish: (completion: CallCompletion<Result>) => Promise<void>,
    options: CallOptions = {},
  ): Promise<Result> {
    const active = currentCall(this.callHost);
    if (active) {
      const result = await work();
      if (active.isOpen)
        await finish({
          transaction: await active.open(),
          result,
          isNested: true,
        });
      return result;
    }
    const call = new CallTransaction(this.callHost);
    let result: Result;
    try {
      result = await runInCall(call, async () => {
        if (!options.opensAtFirstWrite) await call.open();
        const value = await work();
        if (call.isOpen)
          await finish({
            transaction: await call.open(),
            result: value,
            isNested: false,
          });
        return value;
      });
    } catch (error: unknown) {
      await call.end(
        error instanceof Error ? error : new Error("The call failed."),
      );
      throw error;
    }
    await call.end(null);
    return result;
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
    const call = currentCall(this.callHost);
    if (call?.isOpen) return work(readOnlyAccess(await call.open()));
    const scope = currentReadScope();
    return this.executor.readSession((session) => {
      const epoch = this.writes;
      return work({
        agentFiles: this.agentFiles,
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

  /** Runs one transaction as a writer job of its own. */
  private async ownTransaction<Result>(
    work: (transaction: DatabaseTransaction) => Promise<Result>,
  ): Promise<Result> {
    const result = await this.executor.write(async (writer) => {
      const progress: TransactionProgress = {
        scope: undefined,
        epoch: this.writes,
        hasWritten: false,
      };
      try {
        return await runInTransaction(
          writer,
          (transaction) =>
            work({ ...transaction, agentFiles: this.agentFiles }),
          progress,
        );
      } finally {
        // A transaction that only read leaves every remembered answer valid.
        if (progress.hasWritten) this.writes += 1;
      }
    });
    if (this.canCollectPayloads) await this.agentFiles?.collectGarbage(this);
    return result;
  }

  /** Runs one changing statement as a writer job of its own. */
  private async writeStatement(
    statement: string,
    parameters: SqlParameters,
    mode: "execute" | "rows",
  ): Promise<readonly DatabaseValue[][]> {
    return this.write((writer) => writer.run(statement, parameters, mode));
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
      `SELECT name, checksum FROM ${MIGRATIONS_TABLE} ORDER BY name;`,
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
            INSERT INTO ${MIGRATIONS_TABLE} (
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
    const executor = await PostgresExecutor.start(databaseUrl);
    await requireFittingLocale(executor);
    return executor;
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

/** Releases the pool of a database that is refused, so the refusal leaves no connection behind. */
async function requireFittingLocale(executor: PostgresExecutor): Promise<void> {
  try {
    await requireByteOrderedDatabase(executor);
  } catch (error: unknown) {
    await executor.close();
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

/**
 * Runs a transaction of a call as a savepoint of the call's transaction.
 *
 * @remarks
 * A failing nested transaction rolls back only its own statements and runs
 * only its own rollback effects, as it did as a transaction of its own; its
 * commit effects and the effects kept for the call's commit are dropped. A
 * released one hands its commit and rollback effects to the call, so they
 * wait for the call's commit or rollback.
 */
async function savepointTransaction<Result>(
  call: CallTransaction,
  work: (transaction: DatabaseTransaction) => Promise<Result>,
): Promise<Result> {
  const transaction = await call.open();
  const name = call.nextSavepoint();
  const commitEffects: (() => Promise<void>)[] = [];
  const rollbackEffects: (() => Promise<void>)[] = [];
  await transaction.execute(`SAVEPOINT ${name};`);
  call.beginNested();
  try {
    const result = await work({
      ...transaction,
      onCommit: (effect) => {
        commitEffects.push(effect);
      },
      onRollback: (effect) => {
        rollbackEffects.push(effect);
      },
    });
    await transaction.execute(`RELEASE SAVEPOINT ${name};`);
    call.endNested(true);
    for (const effect of commitEffects) transaction.onCommit?.(effect);
    for (const effect of rollbackEffects) transaction.onRollback?.(effect);
    return result;
  } catch (error: unknown) {
    call.endNested(false);
    await transaction.execute(`ROLLBACK TO SAVEPOINT ${name};`);
    await finishFileEffects(rollbackEffects.reverse());
    throw error;
  }
}

/** Read access of a call's transaction that refuses every change. */
function readOnlyAccess(transaction: DatabaseTransaction): DatabaseTransaction {
  const refusal = (): Promise<never> =>
    Promise.reject(new Error("A read transaction cannot change data."));
  return {
    agentFiles: transaction.agentFiles,
    execute: refusal,
    query: async (statement, parameters = {}) => {
      if (statementKind(statement) === "write") return refusal();
      return transaction.query(statement, parameters);
    },
  };
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
