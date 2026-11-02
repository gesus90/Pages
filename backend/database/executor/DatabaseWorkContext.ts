import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Who waits for a database job (PAGE-197).
 *
 * - `request`: an HTTP request; its jobs wait at most the request budget.
 * - `background`: agent persistence, runtime and startup work.
 * - `recurring`: scheduled jobs such as the GitHub synchronization; they
 *   only get a small share of the waiting places.
 */
export type DatabaseWorkClass = "request" | "background" | "recurring";

/** Class and abort signal of the work the current call belongs to. */
export interface DatabaseWorkContext {
  readonly workClass: DatabaseWorkClass;
  readonly signal: AbortSignal | undefined;
}

const contexts = new AsyncLocalStorage<DatabaseWorkContext>();

const BACKGROUND: DatabaseWorkContext = {
  workClass: "background",
  signal: undefined,
};

/**
 * Runs `work` with database jobs of the given class.
 *
 * @param context - Class and optional abort signal, e.g. of the request.
 * @param work - Code whose database jobs belong to the context.
 * @returns Whatever `work` returns.
 */
export function withDatabaseWork<Result>(
  context: DatabaseWorkContext,
  work: () => Promise<Result>,
): Promise<Result> {
  return contexts.run(context, work);
}

/** The context of the current call; work outside any context is background. */
export function currentDatabaseWork(): DatabaseWorkContext {
  return contexts.getStore() ?? BACKGROUND;
}
