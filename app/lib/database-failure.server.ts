import { createContext, data } from "react-router";

import { DatabaseExecutorError } from "@/backend/database/executor/DatabaseExecutorErrors";
import { withDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";

import { watchApplicationServices } from "./database-state.server";

import type { MiddlewareFunction, RouterContextProvider } from "react-router";

/**
 * Stable code of a request the database executor refused or could not confirm (PAGE-197).
 *
 * - `database_busy`: the queue was full, the job waited too long or the
 *   client left before it started; nothing ran.
 * - `database_unavailable`: the database worker is starting, restarting or
 *   failed; nothing ran.
 * - `database_outcome_unknown`: the worker stopped during a change, so it is
 *   unknown whether the change was saved; check before repeating it.
 */
export type DatabaseFailureCode =
  "database_busy" | "database_unavailable" | "database_outcome_unknown";

/** Body of the `503` that replaces a page or resource refused by the executor. */
export interface DatabaseFailureBody {
  readonly error: DatabaseFailureCode;
}

/** The first executor error of one request, recorded by `handleError`. */
interface DatabaseFailureRecord {
  error: DatabaseExecutorError | null;
}

const databaseFailureContext = createContext<DatabaseFailureRecord | null>(
  null,
);

/**
 * Names an executor error for clients without SQL, paths or messages.
 *
 * @param error - The error of the executor.
 * @returns The stable code of its failure.
 */
export function databaseFailureCode(
  error: DatabaseExecutorError,
): DatabaseFailureCode {
  if (error.failure === "unavailable") return "database_unavailable";
  if (error.failure === "outcome_unknown") return "database_outcome_unknown";

  return "database_busy";
}

/**
 * Headers of every `503` that answers an executor error.
 *
 * @param error - The error of the executor.
 * @returns `Retry-After` with the error's delay and `Cache-Control: no-store`.
 */
export function databaseFailureHeaders(
  error: DatabaseExecutorError,
): Record<string, string> {
  return {
    "Cache-Control": "no-store",
    "Retry-After": String(error.retryAfterSeconds),
  };
}

/**
 * Remembers an executor error that escaped a loader, an action or a middleware.
 *
 * @param error - Whatever React Router reports to `handleError`.
 * @param context - Router context of the request, if React Router passed one.
 *
 * @remarks
 * Called from `handleError` in `app/entry.server.tsx`, which React Router
 * calls before it answers the request, so the root middleware sees the
 * record once `next()` returned.
 */
export function recordDatabaseFailure(
  error: unknown,
  context: Readonly<RouterContextProvider> | undefined,
): void {
  if (!(error instanceof DatabaseExecutorError) || !context) return;
  const record = context.get(databaseFailureContext);
  if (record && !record.error) record.error = error;
}

/**
 * Runs the request as `request` database work and adds `Retry-After` to its
 * `503` once an executor error replaced the answer. Afterwards it lets
 * `/health/live` learn about services the request opened.
 *
 * @remarks
 * `request.signal` aborts when the client closed the connection before the
 * response finished (see `@remix-run/node-fetch-server`), so a queued job
 * of a request nobody waits for any more is refused before it starts.
 */
const runDatabaseRequest: MiddlewareFunction = async (
  { request, context },
  next,
) => {
  const record: DatabaseFailureRecord = { error: null };
  context.set(databaseFailureContext, record);
  const response = await withDatabaseWork(
    { workClass: "request", signal: request.signal },
    next,
  );
  watchApplicationServices();
  if (record.error && response instanceof Response && response.status === 503)
    for (const [name, value] of Object.entries(
      databaseFailureHeaders(record.error),
    ))
      response.headers.set(name, value);

  return response;
};

/**
 * Replaces the answer of a request that failed on the executor with a `503`.
 *
 * @remarks
 * The thrown `503` reaches the error boundary as a route error response, in
 * the document as well as in client navigations, so the page explains that
 * Pages is busy instead of showing the generic error. Resource routes answer
 * the JSON body with the same status.
 */
const answerDatabaseFailure: MiddlewareFunction = async ({ context }, next) => {
  const response = await next();
  const error = context.get(databaseFailureContext)?.error;
  if (!error || !(response instanceof Response) || response.status < 500)
    return response;
  // The first rendering is replaced; cancelling it ends its stream.
  await response.body?.cancel();

  throw data<DatabaseFailureBody>(
    { error: databaseFailureCode(error) },
    {
      status: 503,
      statusText: "Service Unavailable",
      headers: databaseFailureHeaders(error),
    },
  );
};

/** Root middleware of PAGE-197; it runs before every other middleware. */
export const databaseRequestMiddleware: readonly MiddlewareFunction[] = [
  runDatabaseRequest,
  answerDatabaseFailure,
];
