import { databaseFailureFacts } from "@/backend/logging/LogError";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";

/**
 * The time budgets of a server stop (PAGE-199).
 *
 * @remarks
 * All cleanup shares one budget, so one stuck step cannot use up the time the
 * database needs. Closing the database has its own: the checkpoint it runs took
 * up to 41.6 s in the logs of 2026-11-02. Together with the last log flush the
 * hard deadline stays below the 90 s `TimeoutStopSec` default of systemd, after
 * which the service manager would kill the database worker as well. The 120 s
 * of `closeTimeoutMs` therefore never end a server stop; when the deadline comes
 * first, the worker finishes on its own after the server left, and nothing
 * claims a closed database. See `docs/DatabaseExecutor.md`.
 */
export const SHUTDOWN_LIMITS = {
  /** Longest shared wait for all cleanup steps before the database closes. */
  cleanupBudgetMs: 30_000,
  /** Longest wait for the database to finish its jobs, checkpoint and close. */
  databaseCloseBudgetMs: 45_000,
  /** The process ends here at the latest, whatever still runs. */
  deadlineMs: 80_000,
} as const;

/** One separately reported part of a server stop. */
export interface ShutdownStep {
  /** Fixed name in the logs. */
  readonly step: string;
  readonly work: () => Promise<void>;
}

/** How the attempt to close the database ended. */
export type DatabaseCloseOutcome =
  "not_attempted" | "closing" | "closed" | "failed" | "timed_out";

/** What the server stop has done so far; it holds only names and a count. */
export interface ShutdownProgress {
  readonly currentStep: string | null;
  readonly cleanupFailures: number;
  readonly databaseClose: DatabaseCloseOutcome;
}

/** A step that was still running when its budget ran out. */
class ShutdownTimeoutError extends Error {
  public constructor(step: string) {
    super(`Shutdown step ${step} exceeded its time budget.`);
    this.name = "ShutdownTimeoutError";
  }
}

const TIMED_OUT = Symbol("timed out");

let cleanupEndsAt: number | null = null;
let currentStep: string | null = null;
let cleanupFailures = 0;
let databaseClose: DatabaseCloseOutcome = "not_attempted";
/** A composed task passes on the failures of its steps; each counts only once. */
const reportedFailures = new WeakSet<object>();

/** Current state of the stop, for the closing and the deadline events. */
export function shutdownProgress(): ShutdownProgress {
  return { currentStep, cleanupFailures, databaseClose };
}

/** Waits for `work` at most `budgetMs`; a later failure of `work` is still logged. */
async function settleWithin(
  step: string,
  work: () => Promise<void>,
  budgetMs: number,
): Promise<typeof TIMED_OUT | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const expiry = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), budgetMs);
  });
  const running = (async (): Promise<undefined> => {
    await work();
    return undefined;
  })();
  try {
    const outcome = await Promise.race([running, expiry]);
    if (outcome === TIMED_OUT)
      void running.catch((error: unknown) => {
        logCaughtError(`shutdown.${step}`, error);
      });
    return outcome;
  } finally {
    clearTimeout(timer);
  }
}

function reportFailedStep(step: string, error: unknown): void {
  if (typeof error === "object" && error !== null) {
    if (reportedFailures.has(error)) return;
    reportedFailures.add(error);
  }
  cleanupFailures += 1;
  logEvent({
    level: "error",
    event: "server.shutdown.step_failed",
    component: "ProcessLifecycle",
    message: "A step of the server stop failed; the remaining steps still run",
    error,
    metadata: { step, ...databaseFailureFacts(error) },
  });
}

function reportTimedOutStep(step: string, budgetMs: number): void {
  cleanupFailures += 1;
  logEvent({
    level: "error",
    event: "server.shutdown.step_timeout",
    component: "ProcessLifecycle",
    message: "A step of the server stop exceeded its budget; it keeps running",
    metadata: { step, durationMs: budgetMs },
  });
}

function remainingCleanupBudget(): number {
  cleanupEndsAt ??= Date.now() + SHUTDOWN_LIMITS.cleanupBudgetMs;
  return Math.max(0, cleanupEndsAt - Date.now());
}

/**
 * Runs one step of the server stop, however the steps before it ended.
 *
 * @param step - The step and its name.
 * @param budgetMs - Longest wait; by default what remains of the shared
 * cleanup budget. A step without any budget left is still started.
 * @returns The failure of the step, or `null`; it was reported already.
 */
export async function runShutdownStep(
  step: ShutdownStep,
  budgetMs: number = remainingCleanupBudget(),
): Promise<unknown> {
  const previous = currentStep;
  currentStep = step.step;
  try {
    const outcome = await settleWithin(step.step, step.work, budgetMs);
    if (outcome !== TIMED_OUT) return null;
    reportTimedOutStep(step.step, budgetMs);
    const timeout = new ShutdownTimeoutError(step.step);
    reportedFailures.add(timeout);
    return timeout;
  } catch (error: unknown) {
    reportFailedStep(step.step, error);
    return error ?? new Error(`Shutdown step ${step.step} failed.`);
  } finally {
    currentStep = previous;
  }
}

/**
 * Runs cleanup steps in order; no failure or timeout keeps the next one from running.
 *
 * @param steps - The steps, in their required order.
 * @returns The failures of the steps, which were reported already.
 */
export async function runShutdownSteps(
  steps: readonly ShutdownStep[],
): Promise<readonly unknown[]> {
  const failures: unknown[] = [];
  for (const step of steps) {
    const failure = await runShutdownStep(step);
    if (failure !== null) failures.push(failure);
  }
  return failures;
}

function closeOutcome(failure: unknown): DatabaseCloseOutcome {
  if (failure === null) return "closed";
  return failure instanceof ShutdownTimeoutError ? "timed_out" : "failed";
}

/**
 * Attempts to close the database with its own budget and records how it ended.
 *
 * @param close - Lets the worker checkpoint and close.
 * @returns The failure, or `null` only after the close confirmed its success.
 *
 * @remarks
 * On a timeout the worker goes on by itself once the server left, so the
 * outcome stays `timed_out` and never claims a closed database.
 */
export async function closeDatabaseForShutdown(
  close: () => Promise<void>,
): Promise<unknown> {
  databaseClose = "closing";
  const failure = await runShutdownStep(
    { step: "database_close", work: close },
    SHUTDOWN_LIMITS.databaseCloseBudgetMs,
  );
  databaseClose = closeOutcome(failure);
  logEvent({
    level: failure === null ? "info" : "error",
    event: "server.shutdown.database_close",
    component: "ProcessLifecycle",
    message:
      failure === null
        ? "The database closed during the server stop"
        : "The database did not confirm its close during the server stop",
    metadata: { databaseClose },
  });
  return failure;
}

/**
 * Passes on the failures of a composed shutdown task.
 *
 * @param failures - Failures of its steps, which were reported already.
 * @throws The only failure itself, or an `AggregateError` of all of them.
 */
export function throwShutdownFailures(failures: readonly unknown[]): void {
  if (failures.length === 0) return;
  if (failures.length === 1) throw failures[0];
  const combined = new AggregateError(
    failures,
    "Several shutdown steps failed.",
  );
  reportedFailures.add(combined);
  throw combined;
}
