/**
 * Errors of the database executor (PAGE-197).
 *
 * @remarks
 * Each error says whether the statement was certainly never started. Only
 * an unstarted job is safe to repeat; a job whose outcome is unknown must be
 * reconciled through the revisions and operation IDs of the caller, never
 * repeated blindly.
 */

/** Why the executor did not run or could not confirm a job. */
export type DatabaseExecutorFailure =
  | "overloaded"
  | "queue_timeout"
  | "aborted"
  | "unavailable"
  | "outcome_unknown";

/** Base class of every executor error; HTTP answers it with 503. */
export abstract class DatabaseExecutorError extends Error {
  /** Seconds after which a repeated request may succeed. */
  public readonly retryAfterSeconds: number;

  protected constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.retryAfterSeconds = retryAfterSeconds;
  }

  /** Whether DuckDB certainly never saw the job, so it may be repeated. */
  public abstract get notStarted(): boolean;

  /** Machine-readable reason for logs and metrics. */
  public abstract get failure(): DatabaseExecutorFailure;
}

/** The queue was full or the job waited longer than its budget; nothing ran. */
export class DatabaseOverloadedError extends DatabaseExecutorError {
  private readonly reason: "overloaded" | "queue_timeout" | "aborted";

  public constructor(reason: "overloaded" | "queue_timeout" | "aborted") {
    super(
      reason === "aborted"
        ? "The database job was cancelled before it started."
        : "The database is busy; the job was not started.",
      5,
    );
    this.name = "DatabaseOverloadedError";
    this.reason = reason;
  }

  public get notStarted(): boolean {
    return true;
  }

  public get failure(): DatabaseExecutorFailure {
    return this.reason;
  }
}

/** The worker is starting, restarting, failed or closed; nothing ran. */
export class DatabaseUnavailableError extends DatabaseExecutorError {
  public constructor(message = "The database is not available.") {
    super(message, 10);
    this.name = "DatabaseUnavailableError";
  }

  public get notStarted(): boolean {
    return true;
  }

  public get failure(): DatabaseExecutorFailure {
    return "unavailable";
  }
}

/**
 * The worker ended while it held a change, so it is unknown whether the
 * change committed. Callers check the current state before acting again.
 */
export class DatabaseOutcomeUnknownError extends DatabaseExecutorError {
  public constructor() {
    super(
      "The database stopped during a change; its outcome is unknown and is not repeated automatically.",
      10,
    );
    this.name = "DatabaseOutcomeUnknownError";
  }

  public get notStarted(): boolean {
    return false;
  }

  public get failure(): DatabaseExecutorFailure {
    return "outcome_unknown";
  }
}
