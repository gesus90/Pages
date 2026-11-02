import { GitHubApiError } from "@/backend/github/GitHubApiClient";
import {
  logCaughtError,
  logDiagnostic,
  logEvent,
} from "@/backend/logging/Logger";

import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";

/** Delay before the first retry after a failed scheduled run. */
const FIRST_RETRY_DELAY_MS = 60_000;

/** Longest delay between two failed scheduled runs of one project. */
const MAXIMUM_RETRY_DELAY_MS = 60 * 60_000;

/**
 * Delay before the next scheduled attempt after consecutive failures:
 * 1 minute, doubling with every further failure, at most 60 minutes.
 *
 * @param failures - Consecutive failed scheduled runs, at least 1.
 * @returns Delay in milliseconds.
 */
export function gitHubSyncRetryDelayMs(failures: number): number {
  const doublings = Math.min(Math.max(failures - 1, 0), 16);

  return Math.min(
    MAXIMUM_RETRY_DELAY_MS,
    FIRST_RETRY_DELAY_MS * 2 ** doublings,
  );
}

/**
 * Backs off the scheduled synchronization of failing projects.
 *
 * @remarks
 * The next attempt is persisted in `next_sync_at`, so the scheduler does
 * not pick the project up on every tick. The count of consecutive failures
 * lives in memory only: after a restart the doubling starts again at one
 * minute, and a successful run (scheduled or manual) resets it.
 */
export class GitHubSyncBackoff {
  private readonly failures = new Map<string, number>();
  private readonly projectRepository: ProjectRepository;
  private readonly now: () => string;

  /**
   * Creates the backoff bookkeeping.
   *
   * @param projectRepository - Repository persisting the next attempt.
   * @param now - Clock returning the current ISO timestamp.
   */
  public constructor(projectRepository: ProjectRepository, now: () => string) {
    this.projectRepository = projectRepository;
    this.now = now;
  }

  /**
   * Forgets the failures of a project after a successful run.
   *
   * @param projectId - Project that synchronized successfully.
   */
  public reset(projectId: string): void {
    this.failures.delete(projectId);
  }

  /**
   * Logs a failed scheduled run and moves the next attempt out.
   *
   * @param projectId - Project whose scheduled run failed.
   * @param error - Cause of the failure; its HTTP status is logged.
   *
   * @remarks
   * The schedule is written in its own short statement after the run has
   * ended, so no database work waits on GitHub. A failing write is logged
   * and otherwise ignored: the project is then simply retried earlier.
   */
  public async recordFailure(projectId: string, error: unknown): Promise<void> {
    const failures = (this.failures.get(projectId) ?? 0) + 1;
    const delayMs = gitHubSyncRetryDelayMs(failures);
    const nextSyncAt = new Date(Date.parse(this.now()) + delayMs).toISOString();

    this.failures.set(projectId, failures);
    logSyncFailure(projectId, failures, delayMs, error);

    try {
      await this.projectRepository.deferNextSync(projectId, nextSyncAt);
    } catch (writeError: unknown) {
      logCaughtError("GitHubSyncBackoff", writeError);

      logDiagnostic(
        "GitHubSyncBackoff",
        "warn",
        "Pages could not postpone the next GitHub synchronization of a failing project.",
        writeError,
      );
    }
  }
}

function logSyncFailure(
  projectId: string,
  failures: number,
  delayMs: number,
  error: unknown,
): void {
  const statusCode = error instanceof GitHubApiError ? error.status : null;
  const isAuthFailure = statusCode === 401 || statusCode === 403;
  const status = statusCode === null ? "" : ` (HTTP ${String(statusCode)})`;
  const minutes = String(Math.round(delayMs / 60_000));

  logEvent({
    level: "error",
    event: "job.github_sync.project_failed",
    component: "GitHubSyncRunner",
    message: `GitHub synchronization of a project failed${status}; next attempt in ${minutes} min.`,
    error,
    metadata: {
      projectId,
      statusCode,
      sequence: failures,
      reason: isAuthFailure ? "github_auth" : "sync_failed",
    },
  });
  logDiagnostic(
    "GitHubSyncRunner",
    "error",
    `Pages could not synchronize a project with GitHub${status}; next attempt in ${minutes} min.`,
    error,
  );
}
