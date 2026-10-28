import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
  SqlParameters,
} from "@/backend/database/Database";

/** One statement that a repository sent to the scripted database. */
export interface RecordedStatement {
  /** Whether the statement asked for rows or only ran. */
  readonly kind: "query" | "execute";
  /** SQL text as written by the repository. */
  readonly statement: string;
  /** Values bound to the statement. */
  readonly parameters: SqlParameters;
  /** Whether the statement ran inside a transaction. */
  readonly inTransaction: boolean;
}

/** Answers the next query, or fails it like a database error would. */
export type ScriptedAnswer = readonly DatabaseValue[][] | Error;

/** A database double that answers queries from a script and records every statement. */
export interface ScriptedDatabase {
  /** The double, usable wherever a repository expects the central database. */
  readonly database: Database;
  /** Every statement in call order. */
  readonly statements: RecordedStatement[];
  /** Number of transactions that were opened. */
  readonly transactions: () => number;
  /** Queues answers for the next queries, in call order. */
  readonly answer: (...answers: ScriptedAnswer[]) => void;
  /** Makes the next execute call fail with the given error. */
  readonly failNextExecute: (error: Error) => void;
  /** Statements of one kind in call order. */
  readonly ofKind: (kind: RecordedStatement["kind"]) => RecordedStatement[];
}

/**
 * Creates a database double for repository unit tests.
 *
 * @remarks
 * Queries without a queued answer return no rows. Transactions run their
 * work immediately against the same recorder and do not open real storage.
 */
export function scriptedDatabase(): ScriptedDatabase {
  const statements: RecordedStatement[] = [];
  const answers: ScriptedAnswer[] = [];
  const executeFailures: Error[] = [];
  let transactionCount = 0;
  let depth = 0;

  async function query(
    statement: string,
    parameters: SqlParameters = {},
  ): Promise<readonly DatabaseValue[][]> {
    statements.push({
      kind: "query",
      statement,
      parameters,
      inTransaction: depth > 0,
    });
    const next = answers.shift() ?? [];
    if (next instanceof Error) {
      throw next;
    }
    return next;
  }

  async function execute(
    statement: string,
    parameters: SqlParameters = {},
  ): Promise<void> {
    statements.push({
      kind: "execute",
      statement,
      parameters,
      inTransaction: depth > 0,
    });
    const failure = executeFailures.shift();
    if (failure) {
      throw failure;
    }
  }

  async function transaction<Result>(
    work: (scope: DatabaseTransaction) => Promise<Result>,
  ): Promise<Result> {
    transactionCount += 1;
    depth += 1;
    try {
      return await work({ query, execute });
    } finally {
      depth -= 1;
    }
  }

  const double: Pick<Database, "query" | "execute" | "transaction"> = {
    query,
    execute,
    transaction,
  };

  return {
    // The double offers every statement method repositories call; the class
    // only adds DuckDB lifecycle members that repositories never use.
    database: double as Database,
    statements,
    transactions: () => transactionCount,
    answer: (...next) => {
      answers.push(...next);
    },
    failNextExecute: (error) => {
      executeFailures.push(error);
    },
    ofKind: (kind) => statements.filter((entry) => entry.kind === kind),
  };
}
