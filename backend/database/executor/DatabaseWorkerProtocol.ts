/**
 * Messages between the Pages server and its database worker process (PAGE-197).
 *
 * @remarks
 * Only plain data crosses the boundary: statements, bound values, rows and
 * error texts. The worker owns every native DuckDB handle; the server never
 * receives one. Values travel with the V8 serializer of `child_process`
 * (`serialization: "advanced"`), which keeps `bigint`, `Buffer` and `null`
 * exact. This file holds types only, so the worker can import it while Node
 * runs the TypeScript source directly.
 */

/** Connection a statement runs on: the single writer or one of the readers. */
export type WorkerRole = "writer" | "reader";

/** Whether a statement returns its rows. */
export type WorkerRunMode = "execute" | "rows";

/** A bound value as it crosses the process boundary. */
export type WireParameterValue =
  string | number | bigint | boolean | Uint8Array | null;

/** A column value as it crosses the process boundary. */
export type WireValue = string | number | bigint | Uint8Array | null;

/** Settings the server hands the worker when it opens the database. */
export interface WorkerConfiguration {
  /** File system path, or `:memory:`. */
  readonly databasePath: string;
  /** Number of reading connections next to the writer. */
  readonly readerConnections: number;
  /** Largest estimated size of one result, in bytes. */
  readonly maximumResultBytes: number;
}

/** An error as the worker reports it; the message is the DuckDB text. */
export interface WireError {
  readonly name: string;
  readonly message: string;
}

/** Opens the database; the first message the server sends. */
export interface WorkerOpenRequest {
  readonly type: "open";
  readonly configuration: WorkerConfiguration;
}

/** Runs one statement on the writer or on a free reader. */
export interface WorkerRunRequest {
  readonly type: "run";
  readonly id: number;
  readonly role: WorkerRole;
  readonly mode: WorkerRunMode;
  readonly statement: string;
  readonly parameters: Readonly<Record<string, WireParameterValue>>;
  /** Measures the write-ahead log around the statement, e.g. for `COMMIT`. */
  readonly measureWal: boolean;
  /** Read session whose reserved reader runs the statement, or null. */
  readonly session: number | null;
}

/**
 * Begins or ends a read session: one reader connection reserved for a
 * read-only transaction, so several SELECTs see one snapshot.
 */
export interface WorkerSessionRequest {
  readonly type: "session";
  readonly id: number;
  readonly action: "begin" | "end";
  readonly session: number;
}

/** Checkpoints and closes the database, then ends the worker. */
export interface WorkerCloseRequest {
  readonly type: "close";
  readonly id: number;
}

/** Every message the server sends. */
export type WorkerRequest =
  | WorkerOpenRequest
  | WorkerRunRequest
  | WorkerSessionRequest
  | WorkerCloseRequest;

/** The database is open and every connection is set up. */
export interface WorkerReadyResponse {
  readonly type: "ready";
  readonly readerConnections: number;
  /** Whether the write-ahead log had to be replayed through an attached copy. */
  readonly walReplayed: boolean;
}

/** The database could not be opened; the worker ends afterwards. */
export interface WorkerOpenFailedResponse {
  readonly type: "open_failed";
  readonly error: WireError;
}

/** Time the worker spent on a statement, apart from the IPC transfer. */
export interface WorkerTiming {
  /** Wait for a free reader inside the worker. */
  readonly waitMs: number;
  /** Execution in DuckDB, including reading and converting the rows. */
  readonly executionMs: number;
  /** Write-ahead log size before the statement, when measured. */
  readonly walBytesBefore: number | null;
  /** Write-ahead log size after the statement, when measured. */
  readonly walBytesAfter: number | null;
}

/** A statement finished. */
export interface WorkerResultResponse {
  readonly type: "result";
  readonly id: number;
  readonly rows: WireValue[][] | null;
  readonly timing: WorkerTiming;
}

/** A statement failed inside DuckDB or was refused before it ran. */
export interface WorkerFailedResponse {
  readonly type: "failed";
  readonly id: number;
  readonly error: WireError;
  readonly timing: WorkerTiming;
  /** True when DuckDB never started the statement, e.g. a refused read. */
  readonly notStarted: boolean;
}

/** The database was checkpointed and closed. */
export interface WorkerClosedResponse {
  readonly type: "closed";
  readonly id: number;
  readonly error: WireError | null;
}

/** Every message the worker sends. */
export type WorkerResponse =
  | WorkerReadyResponse
  | WorkerOpenFailedResponse
  | WorkerResultResponse
  | WorkerFailedResponse
  | WorkerClosedResponse;

/**
 * Error names the worker reports for refusals of its own; type-checked on
 * both sides, because the worker may import nothing but types.
 *
 * - `DatabaseNotReadOnlyError`: a reader got something other than one SELECT.
 * - `DatabaseResultTooLargeError`: a result exceeded the configured size.
 */
export type WorkerRefusalName =
  "DatabaseNotReadOnlyError" | "DatabaseResultTooLargeError";
