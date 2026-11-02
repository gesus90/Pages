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
  /**
   * Fixed label of what started the work, for the content-free write-ahead log
   * counters: a route pattern or a name such as `github_publish`, never a value.
   */
  readonly origin?: string;
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

/**
 * Runs `work` as background work, detached from the request that started it.
 *
 * @remarks
 * Async context outlives a request, so everything a request starts inherits
 * its abort signal and its short queue budget (PAGE-199). Work that has to
 * finish after the client left, such as a GitHub publication, an agent run or
 * an instruction delivery, leaves the request here. This only changes how long
 * its database jobs may wait and that the client's disconnect no longer refuses
 * them: actor and rights stay what the caller passes on and rechecks, and the
 * log correlation of the request is kept. The queues stay bounded, and an
 * explicit stop still works through the abort controllers of the work itself.
 *
 * @param origin - Fixed label of the work, see {@link DatabaseWorkContext.origin}.
 * @param work - Code whose database jobs become background jobs.
 * @returns Whatever `work` returns.
 */
export function withBackgroundDatabaseWork<Result>(
  origin: string,
  work: () => Promise<Result>,
): Promise<Result> {
  return contexts.run({ ...BACKGROUND, origin }, work);
}

/** The context of the current call; work outside any context is background. */
export function currentDatabaseWork(): DatabaseWorkContext {
  return contexts.getStore() ?? BACKGROUND;
}
