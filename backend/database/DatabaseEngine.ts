import type {
  DatabaseExecutorStatus,
  ReaderSession,
  WriterSession,
} from "./DatabaseExecutorTypes";
import type { DatabaseValue, SqlParameters } from "./Database";

/**
 * What the database facade needs from the way statements reach a database.
 *
 * @remarks
 * `postgres/PostgresExecutor.ts` runs PostgreSQL through a connection pool.
 */
export interface DatabaseEngine {
  /** Runs one writer job: a statement or a whole transaction. */
  write<Result>(
    work: (writer: WriterSession) => Promise<Result>,
  ): Promise<Result>;
  /** Runs one read, which sees the last committed state. */
  read(
    statement: string,
    parameters: SqlParameters,
  ): Promise<readonly DatabaseValue[][]>;
  /** Runs several reads on one snapshot of the last committed state. */
  readSession<Result>(
    work: (session: ReaderSession) => Promise<Result>,
  ): Promise<Result>;
  /** Lifecycle and queue counters, free of SQL and values. */
  status(): DatabaseExecutorStatus;
  /** Lets the accepted jobs finish, then releases the database. */
  close(): Promise<void>;
}
