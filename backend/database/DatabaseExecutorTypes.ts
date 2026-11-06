import type { DatabaseValue, SqlParameters } from "./Database";
import type { LaneStatus } from "./executor/DatabaseLane";
type WorkerRunMode = "execute" | "rows";

/** Lifecycle state of the database worker process. */
export type DatabaseWorkerState =
  "starting" | "ready" | "restarting" | "failed" | "closing" | "closed";

/** Snapshot of the worker lifecycle for health and metrics. */
export interface DatabaseWorkerStatus {
  readonly state: DatabaseWorkerState;
  readonly generation: number;
  readonly restarts: number;
  readonly pendingStatements: number;
  readonly pid: number | null;
}

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
