import { AsyncLocalStorage } from "node:async_hooks";

const POLLING_ROUTES = [
  /^\/account-version$/u,
  /^\/health$/u,
  /^\/agent-api\/resources$/u,
  /^\/agent-api\/plan-runs$/u,
  /^\/settings-api\/agents\/[^/]+\/login$/u,
];
const scope = new AsyncLocalStorage<boolean>();

/** Matches only read-only status routes, including their React Router single-fetch URLs. */
export function isPollingRequest(url: string, method: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  try {
    const pathname = new URL(url, "http://pages.invalid").pathname
      .replace(/\/$/u, "")
      .replace(/\.data$/u, "");
    return POLLING_ROUTES.some((pattern) => pattern.test(pathname));
  } catch {
    // Malformed URLs retain ordinary request logging and validation.
    return false;
  }
}

/** Carries the request's polling classification without retaining its URL or payload. */
export function withPollingLogPolicy<Result>(
  isPolling: boolean,
  work: () => Result,
): Result {
  return scope.run(isPolling, work);
}

/** Allows successful polling control responses to remain silent while failures stay visible. */
export function isPollingLogContext(): boolean {
  return scope.getStore() ?? false;
}
