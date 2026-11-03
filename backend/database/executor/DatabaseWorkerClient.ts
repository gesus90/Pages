import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

import { logEvent } from "@/backend/logging/Logger";

import { DATABASE_EXECUTOR_LIMITS } from "./DatabaseExecutorLimits";
import {
  DatabaseOutcomeUnknownError,
  DatabaseUnavailableError,
} from "./DatabaseExecutorErrors";

import type { ChildProcess } from "node:child_process";
import type {
  WireError,
  WireParameterValue,
  WireValue,
  WorkerConfiguration,
  WorkerRequest,
  WorkerResponse,
  WorkerRole,
  WorkerRunMode,
  WorkerTiming,
} from "./DatabaseWorkerProtocol";

/** Lifecycle state of the database worker process. */
export type DatabaseWorkerState =
  "starting" | "ready" | "restarting" | "failed" | "closing" | "closed";

/** One statement for the worker. */
export interface WorkerStatement {
  readonly role: WorkerRole;
  readonly mode: WorkerRunMode;
  readonly statement: string;
  readonly parameters: Readonly<Record<string, WireParameterValue>>;
  readonly measureWal: boolean;
  /** Read session of the statement, or null. */
  readonly session: number | null;
}

/** A finished statement with its time split into worker and transfer. */
export interface WorkerOutcome {
  readonly rows: WireValue[][] | null;
  readonly timing: WorkerTiming;
  /** Send to answer, as the server measured it. */
  readonly roundTripMs: number;
}

/** A statement the worker refused or DuckDB rejected. */
export class WorkerStatementError extends Error {
  public readonly timing: WorkerTiming;
  public readonly notStarted: boolean;

  public constructor(
    error: WireError,
    timing: WorkerTiming,
    notStarted: boolean,
  ) {
    super(error.message);
    this.name = error.name;
    this.timing = timing;
    this.notStarted = notStarted;
  }
}

/** Snapshot of the worker lifecycle for health and metrics. */
export interface DatabaseWorkerStatus {
  readonly state: DatabaseWorkerState;
  readonly generation: number;
  readonly restarts: number;
  readonly pendingStatements: number;
  readonly pid: number | null;
}

interface PendingStatement {
  readonly role: WorkerRole;
  readonly sentAt: number;
  readonly resolve: (outcome: WorkerOutcome) => void;
  readonly reject: (error: Error) => void;
}

/**
 * Path of the worker entry: the shipped bundle in production, the source
 * file, which Node runs with its type stripping, in development and tests.
 */
function workerEntry(): string {
  if (import.meta.env?.PROD)
    return fileURLToPath(new URL("./database-worker.mjs", import.meta.url));
  return fileURLToPath(new URL("./DatabaseWorker.ts", import.meta.url));
}

function workerExecArguments(): string[] {
  return import.meta.env?.PROD ? [] : ["--disable-warning=ExperimentalWarning"];
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Settles with `work`, or with `onTimeout` after `milliseconds`; the timer never outlives it.
 *
 * @param work - The awaited work; it goes on after the deadline.
 * @param milliseconds - Longest wait.
 * @param onTimeout - Supplies the result once the wait ended.
 * @returns The first of both results.
 */
export async function withDeadline<Result>(
  work: Promise<Result>,
  milliseconds: number,
  onTimeout: () => Result,
): Promise<Result> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<Result>((resolve, reject) => {
    timer = setTimeout(() => {
      try {
        resolve(onTimeout());
      } catch (error: unknown) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }, milliseconds);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Owns the database worker process and the IPC channel to it.
 *
 * @remarks
 * Exactly one worker exists at a time, and a new one is only forked after
 * the previous one exited, so two processes never open the file for
 * writing. An unexpected exit fails every statement in flight: a write with
 * an unknown outcome, a read as unavailable. The client then restarts the
 * worker a bounded number of times with growing delay, and gives up into
 * the `failed` state, which `/health` reports as not ready.
 */
export class DatabaseWorkerClient {
  private readonly configuration: WorkerConfiguration;
  private readonly pending = new Map<number, PendingStatement>();
  private readonly unexpectedExits: number[] = [];
  private child: ChildProcess | null = null;
  private state: DatabaseWorkerState = "starting";
  private generation = 0;
  private restarts = 0;
  private nextId = 1;
  private exited: Promise<void> = Promise.resolve();
  private closeAnswer: ((error: WireError | null) => void) | null = null;

  private constructor(configuration: WorkerConfiguration) {
    this.configuration = configuration;
  }

  /**
   * Forks the worker and waits until it opened the database.
   *
   * @param configuration - Database path and limits for the worker.
   * @returns The client with a ready worker.
   * @throws When the worker cannot open the database in time.
   */
  public static async start(
    configuration: WorkerConfiguration,
  ): Promise<DatabaseWorkerClient> {
    const client = new DatabaseWorkerClient(configuration);
    await client.spawn();
    return client;
  }

  /** Generation of the current worker; a transaction stays on one. */
  public get currentGeneration(): number {
    return this.generation;
  }

  /** Lifecycle snapshot. */
  public status(): DatabaseWorkerStatus {
    return {
      state: this.state,
      generation: this.generation,
      restarts: this.restarts,
      pendingStatements: this.pending.size,
      pid: this.child?.pid ?? null,
    };
  }

  /**
   * Sends one statement to the worker.
   *
   * @param statement - Statement, values and connection role.
   * @param generation - Worker the statement must run on, for transactions.
   * @returns Rows and timing once the worker answered.
   * @throws {DatabaseUnavailableError} When the worker is not ready or was
   * replaced since `generation`; nothing was sent.
   * @throws {DatabaseOutcomeUnknownError} When the worker ended during a write.
   * @throws {WorkerStatementError} When DuckDB or the worker rejected it.
   */
  public run(
    statement: WorkerStatement,
    generation: number = this.generation,
  ): Promise<WorkerOutcome> {
    const child = this.child;
    if (
      this.state !== "ready" ||
      child === null ||
      generation !== this.generation
    )
      return Promise.reject(new DatabaseUnavailableError());
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<WorkerOutcome>((resolve, reject) => {
      this.pending.set(id, {
        role: statement.role,
        sentAt: performance.now(),
        resolve,
        reject,
      });
      this.send(child, { type: "run", id, ...statement });
    });
  }

  /**
   * Begins or ends a read session on the worker.
   *
   * @param action - `begin` reserves a reader, `end` frees it.
   * @param session - Number of the session, unique per client.
   * @param generation - Worker the session runs on.
   * @returns Timing of the BEGIN or COMMIT.
   * @throws {DatabaseUnavailableError} When the worker is not ready or was replaced.
   */
  public session(
    action: "begin" | "end",
    session: number,
    generation: number,
  ): Promise<WorkerOutcome> {
    const child = this.child;
    if (
      this.state !== "ready" ||
      child === null ||
      generation !== this.generation
    )
      return Promise.reject(new DatabaseUnavailableError());
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<WorkerOutcome>((resolve, reject) => {
      this.pending.set(id, {
        role: "reader",
        sentAt: performance.now(),
        resolve,
        reject,
      });
      this.send(child, { type: "session", id, action, session });
    });
  }

  /** A new number for a read session. */
  public nextSession(): number {
    const session = this.nextId;
    this.nextId += 1;
    return session;
  }

  /**
   * Lets the worker checkpoint and close the database, then waits for its exit.
   *
   * @throws When the checkpoint failed; the database is closed anyway.
   */
  public async close(): Promise<void> {
    const child = this.child;
    if (child === null || this.state === "closed") {
      this.state = "closed";
      return;
    }
    this.state = "closing";
    const answered = new Promise<WireError | null>((resolve) => {
      this.closeAnswer = resolve;
    });
    this.send(child, { type: "close", id: 0 });
    const error = await withDeadline(
      answered,
      DATABASE_EXECUTOR_LIMITS.closeTimeoutMs,
      (): WireError => ({
        name: "Error",
        message: "Database worker did not close in time.",
      }),
    );
    // The worker leaves stop signals to the server; only a hung one is killed.
    const exitedInTime = await withDeadline(
      this.exited.then(() => true),
      DATABASE_EXECUTOR_LIMITS.exitTimeoutMs,
      () => false,
    );
    if (!exitedInTime) {
      this.child?.kill("SIGKILL");
      await this.exited;
    }
    this.state = "closed";
    if (error !== null)
      throw new Error(`Database checkpoint failed: ${error.message}`);
  }

  private async spawn(): Promise<void> {
    const child = fork(workerEntry(), [], {
      execArgv: workerExecArguments(),
      serialization: "advanced",
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    this.child = child;
    this.exited = new Promise((resolve) => child.once("exit", () => resolve()));
    const opened = new Promise<boolean>((resolve, reject) => {
      child.on("message", (message: WorkerResponse) => {
        if (message.type === "ready") resolve(message.walReplayed);
        else if (message.type === "open_failed")
          reject(new Error(message.error.message));
        else this.receive(message);
      });
      child.once("exit", (code, signal) => {
        reject(
          new DatabaseUnavailableError(
            "The database worker ended while opening.",
          ),
        );
        this.handleExit(child, code, signal);
      });
    });
    this.send(child, { type: "open", configuration: this.configuration });
    const walReplayed = await withDeadline(
      opened,
      DATABASE_EXECUTOR_LIMITS.openTimeoutMs,
      () => {
        // A worker that hangs while opening must end before another may open the file.
        child.kill("SIGKILL");
        throw new DatabaseUnavailableError(
          "The database worker did not open in time.",
        );
      },
    );
    this.generation += 1;
    this.state = "ready";
    logEvent({
      level: walReplayed ? "warn" : "info",
      event: "database.worker.ready",
      component: "DatabaseWorker",
      message: "Database worker opened the database",
      metadata: {
        pid: child.pid ?? null,
        generation: this.generation,
        walReplayed,
      },
    });
  }

  private send(child: ChildProcess, message: WorkerRequest): void {
    child.send(message);
  }

  private receive(message: WorkerResponse): void {
    if (message.type === "closed") {
      this.closeAnswer?.(message.error);
      return;
    }
    if (message.type !== "result" && message.type !== "failed") return;
    const pending = this.pending.get(message.id);
    if (pending === undefined) return;
    this.pending.delete(message.id);
    if (message.type === "failed") {
      // A worker that is closing refuses unstarted; callers see the executor error.
      pending.reject(
        message.notStarted && message.error.name === "DatabaseUnavailableError"
          ? new DatabaseUnavailableError()
          : new WorkerStatementError(
              message.error,
              message.timing,
              message.notStarted,
            ),
      );
      return;
    }
    pending.resolve({
      rows: message.rows,
      timing: message.timing,
      roundTripMs: performance.now() - pending.sentAt,
    });
  }

  private handleExit(
    child: ChildProcess,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (this.child !== child) return;
    this.child = null;
    for (const statement of this.pending.values())
      statement.reject(
        statement.role === "writer"
          ? new DatabaseOutcomeUnknownError()
          : new DatabaseUnavailableError(
              "The database worker ended during a read.",
            ),
      );
    this.pending.clear();
    this.closeAnswer?.(null);
    if (this.state === "closing" || this.state === "closed") return;
    logEvent({
      level: "error",
      event: "database.worker.exited",
      component: "DatabaseWorker",
      message: "Database worker ended unexpectedly",
      metadata: {
        code,
        signal,
        generation: this.generation,
        state: this.state,
      },
    });
    if (this.state === "ready") void this.restart();
  }

  /** Forks a new worker after an unexpected exit, within the restart budget. */
  private async restart(): Promise<void> {
    const now = Date.now();
    const recent = this.unexpectedExits.filter(
      (time) => now - time < DATABASE_EXECUTOR_LIMITS.restartWindowMs,
    );
    recent.push(now);
    this.unexpectedExits.splice(0, this.unexpectedExits.length, ...recent);
    if (recent.length > DATABASE_EXECUTOR_LIMITS.maximumRestarts) {
      this.state = "failed";
      logEvent({
        level: "fatal",
        event: "database.worker.failed",
        component: "DatabaseWorker",
        message:
          "Database worker restart budget exhausted; the database stays unavailable",
        metadata: { restarts: this.restarts },
      });
      return;
    }
    this.state = "restarting";
    await delay(
      DATABASE_EXECUTOR_LIMITS.restartDelayMs * 2 ** (recent.length - 1),
    );
    try {
      this.restarts += 1;
      await this.spawn();
    } catch (error: unknown) {
      logEvent({
        level: "error",
        event: "database.worker.restart_failed",
        component: "DatabaseWorker",
        message: "Database worker could not reopen the database",
        error,
        metadata: { restarts: this.restarts },
      });
      // The failed worker must be gone before the next one opens the file.
      await this.exited;
      this.child = null;
      if (this.state === "restarting") void this.restart();
    }
  }
}
