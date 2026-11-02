import type { DatabaseExecutorError } from "@/backend/database/executor/DatabaseExecutorErrors";
import type { AgentOperationDetails } from "@/definition/PagesAgentOperations";
import type { PagesAgentApiErrorCode } from "@/definition/PagesAgentApi";

const DATABASE_FAILURE_CODES = {
  overloaded: "DATABASE_BUSY",
  queue_timeout: "DATABASE_BUSY",
  aborted: "DATABASE_BUSY",
  unavailable: "DATABASE_UNAVAILABLE",
  outcome_unknown: "DATABASE_OUTCOME_UNKNOWN",
} as const satisfies Record<
  DatabaseExecutorError["failure"],
  PagesAgentApiErrorCode
>;

/** Sends fixed credential-safe agent API failures. */
export function agentApiFailure(
  code: PagesAgentApiErrorCode,
  status: number,
  details?: AgentOperationDetails,
): Response {
  const attachmentMessage =
    details &&
    "reason" in details &&
    details.reason.startsWith("ticket_attachment_")
      ? "Upload the image or file as an attachment to this ticket. Temporary uploads must be available, unexpired and owned by you; external image addresses are not allowed."
      : null;
  return Response.json(
    {
      apiVersion: "1",
      error: {
        code,
        message:
          attachmentMessage ??
          (code === "NOT_FOUND"
            ? "Not found or no access."
            : "The agent API request was rejected."),
        retryable: false,
        ...(details === undefined ? {} : { details }),
      },
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...(status === 401 ? { "WWW-Authenticate": "Bearer" } : {}),
        ...(status === 405 ? { Allow: "POST" } : {}),
      },
    },
  );
}

/**
 * Answers a database job the executor refused or could not confirm (PAGE-197).
 *
 * @param error - The error of the executor.
 * @returns `503` with `Retry-After`; `retryable` is true only when the job
 * certainly never started. A change of unknown outcome is checked, not repeated.
 */
export function agentApiDatabaseFailure(
  error: DatabaseExecutorError,
): Response {
  return Response.json(
    {
      apiVersion: "1",
      error: {
        code: DATABASE_FAILURE_CODES[error.failure],
        message: error.notStarted
          ? "The database is busy or unavailable; the request was not started. Retry after the given delay."
          : "The database stopped during the change; its outcome is unknown. Check the current state before repeating it.",
        retryable: error.notStarted,
      },
    },
    {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Retry-After": String(error.retryAfterSeconds),
      },
    },
  );
}
