/**
 * Database worker process: the single owner of the DuckDB instance (PAGE-197).
 *
 * @remarks
 * The server starts this file with `child_process.fork` and talks to it over
 * the IPC channel only. It opens the database once, holds one writer
 * connection, which runs the statements the server sends for it one after
 * the other, and a small pool of reader connections of the same instance,
 * which run single SELECT statements next to the writer. DuckDB gives every
 * reader the last committed state, so an open or slow write never holds a
 * read back.
 *
 * The file imports nothing from Pages but types: in development and tests
 * Node runs it directly, and the build ships it as
 * `build/server/database-worker.mjs`.
 */
import { stat } from "node:fs/promises";
import process from "node:process";

import {
  DuckDBBlobValue,
  DuckDBInstance,
  StatementType,
} from "@duckdb/node-api";

import type { DuckDBConnection, DuckDBValue } from "@duckdb/node-api";
import type {
  WireError,
  WireParameterValue,
  WireValue,
  WorkerConfiguration,
  WorkerRefusalName,
  WorkerRequest,
  WorkerResponse,
  WorkerRunRequest,
  WorkerSessionRequest,
  WorkerTiming,
} from "./DatabaseWorkerProtocol";

const IN_MEMORY_DATABASE_PATH = ":memory:";

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

/** Text DuckDB reports when it cannot replay the write-ahead log of a file. */
const WAL_REPLAY_FAILURE = "Failure while replaying WAL";

/** The open database with its connections. */
interface OpenDatabase {
  readonly configuration: WorkerConfiguration;
  readonly instance: DuckDBInstance;
  readonly writer: DuckDBConnection;
  readonly readers: readonly DuckDBConnection[];
}

/** A read or read session waiting for a free reader connection. */
interface WaitingRead {
  readonly queuedAt: number;
  readonly start: (
    connection: DuckDBConnection,
    waitMs: number,
  ) => Promise<void>;
  /** Whether the connection returns to the pool once `start` finished. */
  readonly releases: boolean;
}

/** A refusal of the worker itself; DuckDB never saw the statement. */
class WorkerRefusal extends Error {
  public override readonly name: WorkerRefusalName;

  public constructor(name: WorkerRefusalName, message: string) {
    super(message);
    this.name = name;
  }
}

let database: OpenDatabase | null = null;
let isClosing = false;
/** Writer statements run strictly one after the other in arrival order. */
let writerChain: Promise<void> = Promise.resolve();
const freeReaders: DuckDBConnection[] = [];
const waitingReads: WaitingRead[] = [];
/** A reader connection reserved by a read session. */
interface ReadSession {
  readonly connection: DuckDBConnection;
  /** Statements of one session run one after the other on its connection. */
  chain: Promise<void>;
}

/** Open read sessions by session number. */
const sessions = new Map<number, ReadSession>();
let runningReads = 0;

function send(message: WorkerResponse): void {
  process.send?.(message);
}

function toWireError(error: unknown): WireError {
  if (error instanceof Error)
    return { name: error.name, message: error.message };
  return { name: "Error", message: String(error) };
}

/**
 * Opens a DuckDB instance, replaying a write-ahead log that DuckDB cannot
 * replay while it opens the file as its main database.
 *
 * @remarks
 * DuckDB 1.5 fails to replay an `ALTER TABLE` of a table whose defaults call
 * a macro such as `utc_now()`, because no default database exists yet while
 * the main database loads. Attached to an in-memory instance the same log
 * replays; a checkpoint then writes it into the file, and the file opens.
 */
async function openInstance(databasePath: string): Promise<{
  readonly instance: DuckDBInstance;
  readonly walReplayed: boolean;
}> {
  try {
    return {
      instance: await DuckDBInstance.create(databasePath),
      walReplayed: false,
    };
  } catch (error: unknown) {
    if (!String(error).includes(WAL_REPLAY_FAILURE)) throw error;
    await replayWriteAheadLog(databasePath);
    return {
      instance: await DuckDBInstance.create(databasePath),
      walReplayed: true,
    };
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

async function openConnection(
  instance: DuckDBInstance,
): Promise<DuckDBConnection> {
  const connection = await instance.connect();
  await connection.run(CONNECTION_SETUP);
  return connection;
}

async function openDatabase(configuration: WorkerConfiguration): Promise<void> {
  try {
    const { instance, walReplayed } = await openInstance(
      configuration.databasePath,
    );
    const writer = await openConnection(instance);
    const readers: DuckDBConnection[] = [];
    // One after the other: the setup re-creates the macros in the catalog.
    for (let index = 0; index < configuration.readerConnections; index += 1)
      readers.push(await openConnection(instance));
    database = { configuration, instance, writer, readers };
    freeReaders.push(...readers);
    send({ type: "ready", readerConnections: readers.length, walReplayed });
  } catch (error: unknown) {
    send({ type: "open_failed", error: toWireError(error) });
    process.exitCode = 1;
    process.disconnect();
  }
}

/**
 * Converts repository parameters to DuckDB values.
 *
 * @returns `undefined` without parameters, because DuckDB only runs several
 * statements in one call when nothing is bound.
 */
function toBindings(
  parameters: Readonly<Record<string, WireParameterValue>>,
): Record<string, DuckDBValue> | undefined {
  const entries = Object.entries(parameters);
  if (entries.length === 0) return undefined;
  return Object.fromEntries(
    entries.map(([name, value]) => [name, toBinding(value)]),
  );
}

function toBinding(value: WireParameterValue): DuckDBValue {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Uint8Array) return new DuckDBBlobValue(value);
  return value;
}

/**
 * Converts a DuckDB value to the value types repositories read.
 *
 * @remarks
 * `COUNT` and `SUM` return `BIGINT`; those values become plain numbers while
 * they fit, so repositories read them like any other integer.
 */
function toWireValue(value: DuckDBValue): WireValue {
  if (value === null || typeof value === "string" || typeof value === "number")
    return value;
  if (typeof value === "bigint")
    return Number.isSafeInteger(Number(value)) ? Number(value) : value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof DuckDBBlobValue) return Buffer.from(value.bytes);
  throw new Error("Database returned a value of an unsupported type.");
}

/** Estimated serialized size of a value, in bytes. */
function wireSize(value: WireValue): number {
  if (typeof value === "string") return value.length * 2 + 8;
  if (value instanceof Uint8Array) return value.byteLength + 8;
  return 8;
}

function toWireRows(
  rows: readonly (readonly DuckDBValue[])[],
  maximumBytes: number,
): WireValue[][] {
  let bytes = 0;
  return rows.map((row) =>
    row.map((value) => {
      const converted = toWireValue(value);
      bytes += wireSize(converted);
      if (bytes > maximumBytes)
        throw new WorkerRefusal(
          "DatabaseResultTooLargeError",
          `Database result exceeds ${String(maximumBytes)} bytes; read it in pages.`,
        );
      return converted;
    }),
  );
}

async function runStatement(
  open: OpenDatabase,
  request: WorkerRunRequest,
): Promise<WireValue[][] | null> {
  const bindings = toBindings(request.parameters);
  if (request.mode === "execute") {
    await open.writer.run(request.statement, bindings);
    return null;
  }
  const reader = await open.writer.runAndReadAll(request.statement, bindings);
  return toWireRows(reader.getRows(), open.configuration.maximumResultBytes);
}

/**
 * Runs one SELECT on a reader connection.
 *
 * @remarks
 * DuckDB parses the statement and names its type, so a reader never runs a
 * change, whatever the text looks like; anything else goes back to the
 * server, which runs it on the writer.
 */
async function runReadOnly(
  open: OpenDatabase,
  connection: DuckDBConnection,
  request: WorkerRunRequest,
): Promise<WireValue[][]> {
  const extracted = await connection.extractStatements(request.statement);
  if (extracted.count !== 1)
    throw new WorkerRefusal(
      "DatabaseNotReadOnlyError",
      "A reader runs exactly one statement.",
    );
  const prepared = await extracted.prepare(0);
  try {
    if (prepared.statementType !== StatementType.SELECT)
      throw new WorkerRefusal(
        "DatabaseNotReadOnlyError",
        "A reader runs SELECT statements only.",
      );
    const bindings = toBindings(request.parameters);
    if (bindings) prepared.bind(bindings);
    const reader = await prepared.runAndReadAll();
    return toWireRows(reader.getRows(), open.configuration.maximumResultBytes);
  } finally {
    prepared.destroySync();
  }
}

/** Size of the write-ahead log, or null for an in-memory database. */
async function walBytes(databasePath: string): Promise<number | null> {
  if (databasePath === IN_MEMORY_DATABASE_PATH) return null;
  try {
    return (await stat(`${databasePath}.wal`)).size;
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return 0;
    return null;
  }
}

/** Runs `work`, then answers the request with its rows or its error. */
async function answer(
  request: WorkerRunRequest,
  waitMs: number,
  work: () => Promise<WireValue[][] | null>,
): Promise<void> {
  const path = database?.configuration.databasePath ?? IN_MEMORY_DATABASE_PATH;
  const walBytesBefore = request.measureWal ? await walBytes(path) : null;
  const startedAt = performance.now();
  try {
    const rows = await work();
    const timing: WorkerTiming = {
      waitMs,
      executionMs: performance.now() - startedAt,
      walBytesBefore,
      walBytesAfter: request.measureWal ? await walBytes(path) : null,
    };
    send({ type: "result", id: request.id, rows, timing });
  } catch (error: unknown) {
    const timing: WorkerTiming = {
      waitMs,
      executionMs: performance.now() - startedAt,
      walBytesBefore,
      walBytesAfter: null,
    };
    const notStarted =
      error instanceof WorkerRefusal &&
      error.name === "DatabaseNotReadOnlyError";
    send({
      type: "failed",
      id: request.id,
      error: toWireError(error),
      timing,
      notStarted,
    });
  }
}

function refuse(id: number, name: string, message: string): void {
  send({
    type: "failed",
    id,
    error: { name, message },
    timing: {
      waitMs: 0,
      executionMs: 0,
      walBytesBefore: null,
      walBytesAfter: null,
    },
    notStarted: true,
  });
}

function releaseReader(connection: DuckDBConnection): void {
  freeReaders.push(connection);
  const next = waitingReads.shift();
  if (next !== undefined) startRead(next);
}

/** Hands a free reader connection to `waiting`, or queues it until one is free. */
function startRead(waiting: WaitingRead): void {
  const connection = freeReaders.pop();
  if (connection === undefined) {
    waitingReads.push(waiting);
    return;
  }
  runningReads += 1;
  void waiting
    .start(connection, performance.now() - waiting.queuedAt)
    .finally(() => {
      runningReads -= 1;
      if (waiting.releases) releaseReader(connection);
    });
}

function runRead(open: OpenDatabase, request: WorkerRunRequest): void {
  if (request.session === null) {
    startRead({
      queuedAt: performance.now(),
      releases: true,
      start: (connection, waitMs) =>
        answer(request, waitMs, () => runReadOnly(open, connection, request)),
    });
    return;
  }
  const session = sessions.get(request.session);
  if (session === undefined) {
    refuse(
      request.id,
      "DatabaseUnavailableError",
      "The read session is not open.",
    );
    return;
  }
  runningReads += 1;
  session.chain = session.chain
    .then(() =>
      answer(request, 0, () => runReadOnly(open, session.connection, request)),
    )
    .finally(() => {
      runningReads -= 1;
    });
}

/**
 * Reserves a reader for a read-only transaction, or ends it and frees the reader.
 *
 * @remarks
 * Every SELECT of the session then sees the snapshot of its BEGIN. The end
 * commits the transaction, which changed nothing, and gives the connection
 * back even when the commit failed.
 */
function runSession(request: WorkerSessionRequest): void {
  const statement =
    request.action === "begin" ? "BEGIN TRANSACTION;" : "COMMIT;";
  const control: WorkerRunRequest = {
    type: "run",
    id: request.id,
    role: "reader",
    mode: "execute",
    statement,
    parameters: {},
    measureWal: false,
    session: request.session,
  };
  if (request.action === "begin") {
    startRead({
      queuedAt: performance.now(),
      releases: false,
      start: async (connection, waitMs) => {
        const opening = answer(control, waitMs, async () => {
          await connection.run(statement);
          return null;
        });
        sessions.set(request.session, { connection, chain: opening });
        await opening;
      },
    });
    return;
  }
  const session = sessions.get(request.session);
  if (session === undefined) {
    refuse(
      request.id,
      "DatabaseUnavailableError",
      "The read session is not open.",
    );
    return;
  }
  sessions.delete(request.session);
  const { connection } = session;
  void session.chain
    .then(() =>
      answer(control, 0, async () => {
        try {
          await connection.run(statement);
        } catch (error: unknown) {
          // A reader must never return to the pool inside an old snapshot.
          await connection.run("ROLLBACK;").catch(() => undefined);
          throw error;
        }
        return null;
      }),
    )
    .finally(() => releaseReader(connection));
}

function run(request: WorkerRunRequest | WorkerSessionRequest): void {
  const open = database;
  if (open === null || isClosing) {
    refuse(request.id, "DatabaseUnavailableError", "The database is not open.");
    return;
  }
  if (request.type === "session") {
    runSession(request);
    return;
  }
  if (request.role === "reader") {
    runRead(open, request);
    return;
  }
  writerChain = writerChain.then(() =>
    answer(request, 0, () => runStatement(open, request)),
  );
}

async function waitForReads(): Promise<void> {
  while (runningReads > 0)
    await new Promise((resolve) => setTimeout(resolve, 10));
}

/**
 * Checkpoints pending WAL changes with a live connection, then closes.
 *
 * @remarks
 * DuckDB 1.5.5 can serialize stale buffered ART indexes during its
 * context-free shutdown checkpoint after WAL replay, so the writer
 * checkpoints first. A failed checkpoint is reported; it never implies
 * cleanup.
 */
async function closeDatabase(
  rollbackFirst: boolean,
): Promise<WireError | null> {
  const open = database;
  if (open === null) return null;
  isClosing = true;
  await writerChain;
  await waitForReads();
  let failure: WireError | null = null;
  try {
    // After a lost server an open transaction is abandoned, never committed.
    if (rollbackFirst)
      await open.writer.run("ROLLBACK;").catch(() => undefined);
    await open.writer.run("CHECKPOINT;");
  } catch (error: unknown) {
    failure = toWireError(error);
  } finally {
    for (const reader of open.readers) reader.closeSync();
    open.writer.closeSync();
    open.instance.closeSync();
    database = null;
  }
  return failure;
}

async function handle(message: WorkerRequest): Promise<void> {
  if (message.type === "open") {
    if (database === null) await openDatabase(message.configuration);
    return;
  }
  if (message.type === "run" || message.type === "session") {
    run(message);
    return;
  }
  const startedAt = performance.now();
  const error = await closeDatabase(false);
  // The server's stop deadline may have ended it during the checkpoint.
  if (!process.connected) {
    reportClosedWithoutServer(startedAt, error);
    return;
  }
  send({ type: "closed", id: message.id, error });
  process.disconnect();
}

/** Nobody else can report this end; the server and its logger are gone. */
function reportClosedWithoutServer(
  startedAt: number,
  error: WireError | null,
): void {
  process.exitCode = error === null ? 0 : 1;
  console.error(
    JSON.stringify({
      event: "database.worker.closed",
      reason: "server_gone",
      durationMs: Math.round(performance.now() - startedAt),
      isCheckpointed: error === null,
    }),
  );
}

process.title = "pages-database-worker";
// A service manager or a terminal signals the whole process group. The
// server owns the lifecycle: it lets the worker checkpoint and close, and if
// the server is gone, the disconnect handler below does the same.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
  process.on(signal, () => undefined);
process.on("message", (message: WorkerRequest) => {
  void handle(message);
});
// Without the server nobody can use the database; close it like a regular stop.
process.on("disconnect", () => {
  if (isClosing) return;
  const startedAt = performance.now();
  void closeDatabase(true).then((error) => {
    reportClosedWithoutServer(startedAt, error);
  });
});
