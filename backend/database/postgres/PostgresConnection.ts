import { logEvent } from "@/backend/logging/Logger";

import { recordDatabaseQuery } from "../DatabaseStats";
import { holdsTransaction } from "../TransactionState";
import {
  DatabaseOutcomeUnknownError,
  DatabaseUnavailableError,
} from "../executor/DatabaseExecutorErrors";
import { bindStatement } from "./PostgresStatement";

import type { PoolClient, QueryResult } from "pg";
import type { DatabaseValue, SqlParameters } from "../Database";

type WorkerRunMode = "execute" | "rows";

/** Which lane a connection serves. */
export type PostgresConnectionRole = "writer" | "reader";

/** An earlier statement failed, so the transaction was rolled back instead of committed. */
export class AbortedTransactionError extends Error {
  public constructor() {
    super("The transaction was rolled back after a refused statement.");
    this.name = "AbortedTransactionError";
  }
}

/** A statement cannot use a text with U+0000 as it asked to; the error holds no content. */
export class NulTextQueryError extends Error {
  public constructor() {
    super("A query cannot return a text with U+0000.");
    this.name = "NulTextQueryError";
  }
}

/**
 * The code of a driver or server error for the log metadata.
 *
 * @param error - Any caught error.
 * @returns The code, or `null` when it has none.
 *
 * @remarks
 * The log keeps only codes that start with a letter, and SQLSTATE codes such
 * as `28P01` mostly start with a digit. Metadata keeps them, and they hold no value.
 */
export function postgresErrorCode(error: unknown): string | null {
  return error instanceof Error &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : null;
}

/** The server refused the statement; the connection itself still works. */
function isStatementRefusal(error: unknown): boolean {
  return (
    error instanceof Error && "severity" in error && error.severity === "ERROR"
  );
}

/**
 * Turns the COMMIT of an aborted transaction into an error.
 *
 * @remarks
 * After a refused statement PostgreSQL answers a COMMIT without an error, but
 * rolls back and reports the command `ROLLBACK`. Taken as a success, the facade
 * would confirm changes that were never stored.
 */
function refuseSilentRollback(
  statement: string,
  result: QueryResult | QueryResult[],
): void {
  if (
    /^\s*COMMIT\b/iu.test(statement) &&
    lastResult(result)?.command === "ROLLBACK"
  )
    throw new AbortedTransactionError();
}

/** A query that returns a compared value cannot answer for a text with U+0000. */
function refuseEchoedStandIn(
  rows: readonly DatabaseValue[][],
  standIns: readonly string[],
): void {
  if (standIns.length === 0) return;
  const isEchoed = rows.some((row) =>
    row.some(
      (value) =>
        typeof value === "string" &&
        standIns.some((standIn) => value.includes(standIn)),
    ),
  );
  if (isEchoed) throw new NulTextQueryError();
}

function lastResult(result: QueryResult | QueryResult[]): QueryResult | null {
  return Array.isArray(result) ? (result.at(-1) ?? null) : result;
}

function operationOf(statement: string): string {
  return /^\s*([A-Za-z]+)/u.exec(statement)?.[1]?.toUpperCase() ?? "OTHER";
}

/**
 * One pooled connection for the length of one job of a lane.
 *
 * @remarks
 * The pool only listens for errors of idle connections. A connection that is
 * checked out needs its own listener, or a lost server ends the process.
 */
export class PostgresConnection {
  private readonly client: PoolClient;
  private readonly role: PostgresConnectionRole;
  private isBroken = false;
  private isInTransaction = false;
  private readonly onConnectionError: (error: Error) => void;

  /**
   * Takes a checked-out connection for one job.
   *
   * @param client - The connection from the pool.
   * @param role - The lane of the job.
   */
  public constructor(client: PoolClient, role: PostgresConnectionRole) {
    this.client = client;
    this.role = role;
    this.onConnectionError = (error) => this.markLost(error);
    client.on("error", this.onConnectionError);
  }

  /**
   * Runs one statement on this connection.
   *
   * @param statement - SQL owned by a repository.
   * @param parameters - Values bound to the named placeholders.
   * @param mode - `rows` answers with the rows of the last statement.
   * @returns The rows, or none in `execute` mode.
   * @throws {DatabaseOutcomeUnknownError} When a writer lost the connection.
   * @throws {DatabaseUnavailableError} When a reader lost the connection.
   */
  public async run(
    statement: string,
    parameters: SqlParameters,
    mode: WorkerRunMode,
  ): Promise<readonly DatabaseValue[][]> {
    const { text, values, removedNulCharacters, comparisonStandIns } =
      bindStatement(statement, parameters);
    if (removedNulCharacters > 0)
      logEvent({
        level: "warn",
        event: "database.text.nul_removed",
        component: "Database",
        message: "U+0000 removed from text bound to a statement",
        metadata: { count: removedNulCharacters },
      });
    const startedAt = performance.now();
    let rows: readonly DatabaseValue[][];
    try {
      // Without values the driver uses the simple protocol, the only one that
      // runs several statements in one call; migrations rely on that.
      const result = await this.client.query(
        values.length === 0
          ? { text, rowMode: "array" }
          : { text, values, rowMode: "array" },
      );
      this.isInTransaction = holdsTransaction(statement, this.isInTransaction);
      refuseSilentRollback(statement, result);
      recordDatabaseQuery(statement, performance.now() - startedAt, {
        role: this.role,
        workerWaitMs: 0,
        ipcMs: 0,
        walBytesBefore: null,
        walBytesAfter: null,
      });
      rows = mode === "rows" ? (lastResult(result)?.rows ?? []) : [];
    } catch (error: unknown) {
      throw this.translateFailure(statement, values.length, error);
    }
    refuseEchoedStandIn(rows, comparisonStandIns);
    return rows;
  }

  /** Prevents a session with uncertain lock cleanup from ever returning to the pool. */
  public discard(): void {
    this.isBroken = true;
  }

  /** Returns the connection; one that is broken or holds a transaction is closed. */
  public release(): void {
    this.client.removeListener("error", this.onConnectionError);
    this.client.release(this.isBroken || this.isInTransaction);
  }

  private markLost(error: Error): void {
    this.isBroken = true;
    logEvent({
      level: "error",
      event: "database.connection.lost",
      component: "Database",
      message: "A checked-out PostgreSQL connection ended",
      error,
      metadata: { role: this.role, code: postgresErrorCode(error) },
    });
  }

  private translateFailure(
    statement: string,
    parameterCount: number,
    error: unknown,
  ): unknown {
    logEvent({
      level: "error",
      event: "database.statement.failed",
      component: "Database",
      message: "Database statement failed",
      error,
      metadata: {
        parameterCount,
        operation: operationOf(statement),
        code: postgresErrorCode(error),
      },
    });
    if (isStatementRefusal(error) || error instanceof AbortedTransactionError)
      return error;
    this.isBroken = true;
    return this.role === "writer"
      ? new DatabaseOutcomeUnknownError()
      : new DatabaseUnavailableError(
          "The database connection ended during a read.",
        );
  }
}
