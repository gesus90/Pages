import { createContext } from "react-router";

import { logEvent } from "@/backend/logging/Logger";

import type { ReportedProtocol, RequestEntry } from "@/definition/RequestEntry";

/**
 * How the request reached the API, set by the entrance of the server
 * (`admitForwardedHeaders`). `null` for a request that never passed it.
 */
export const requestEntryContext = createContext<RequestEntry | null>(null);

/** Why the `Origin` of a request is not the public origin of Pages. */
export type OriginMismatchReason =
  | "origin_unreadable"
  | "host_mismatch"
  | "port_mismatch"
  | "scheme_mismatch"
  | "scheme_not_forwarded"
  | "scheme_proxy_untrusted";

/** What the browser says about the relation of the page to the request (`Sec-Fetch-Site`). */
export type FetchSite =
  | "same-origin"
  | "same-site"
  | "cross-site"
  | "none"
  | "absent";

/** Facts about a refused request that are safe to log and to show an operator. */
export interface OriginRefusal {
  /**
   * `originRejected` when a hop in front of Pages may have changed the origin
   * the request is compared with; `accessDenied` for an origin that is foreign
   * with no hop to blame.
   */
  readonly code: "originRejected" | "accessDenied";
  readonly reason: OriginMismatchReason;
  /** Normalized `scheme://host[:port]` Pages computed for itself, or `unreadable`. */
  readonly expectedOrigin: string;
  /** Normalized `scheme://host[:port]` of the `Origin` header, or `unreadable`. */
  readonly receivedOrigin: string;
  readonly forwardedProtocol: ReportedProtocol | "unknown";
  readonly isTrustedProxy: boolean;
  readonly fetchSite: FetchSite;
}

/** One origin split into the parts that are compared and logged. */
interface OriginParts {
  readonly scheme: string;
  readonly host: string;
  readonly port: string;
}

const ORIGIN_PATTERN =
  /^(https?):\/\/([a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?|\[[0-9a-f:.]{2,45}\])(?::([0-9]{1,5}))?$/iu;
const MAXIMUM_ORIGIN_LENGTH = 300;
const LOG_WINDOW_MS = 60_000;
const MAXIMUM_LOGGED_PER_WINDOW = 20;

/** A flood of foreign requests must not flood the log: the budget of the current minute. */
const logBudget = { windowStartedAt: 0, logged: 0, suppressed: 0 };

/**
 * Splits an origin, accepting nothing but the plain form `scheme://host[:port]`.
 *
 * @remarks
 * The result is only ever logged, in this form: whatever else a client wrote
 * in its `Origin` header never reaches a log line.
 */
function readOriginParts(text: string): OriginParts | null {
  if (text.length > MAXIMUM_ORIGIN_LENGTH) return null;

  const match = ORIGIN_PATTERN.exec(text);
  const scheme = match?.[1];
  const host = match?.[2];

  if (scheme === undefined || host === undefined) return null;

  return {
    scheme: scheme.toLowerCase(),
    host: host.toLowerCase(),
    port: match?.[3] ?? "",
  };
}

function formatOrigin(parts: OriginParts | null): string {
  if (parts === null) return "unreadable";

  const authority =
    parts.port === "" ? parts.host : `${parts.host}:${parts.port}`;

  return `${parts.scheme}://${authority}`;
}

function readFetchSite(request: Request): FetchSite {
  const value = request.headers.get("sec-fetch-site")?.trim().toLowerCase();

  if (
    value === "same-origin" ||
    value === "same-site" ||
    value === "cross-site" ||
    value === "none"
  ) {
    return value;
  }

  return "absent";
}

/**
 * Tells whether a refused origin may be the fault of a hop in front of Pages
 * rather than of the sender.
 *
 * @remarks
 * A browser that reports the call as cross-site or same-site names a page that
 * is not Pages, whatever the proxies did. One that reports it as same-origin,
 * or a request that came through a hop, may be Pages' own page compared with a
 * wrong address.
 */
function isForwardingArtifact(
  fetchSite: FetchSite,
  entry: RequestEntry | null,
): boolean {
  if (fetchSite === "cross-site" || fetchSite === "same-site") return false;

  return fetchSite === "same-origin" || entry?.isForwarded === true;
}

function classifySchemeMismatch(
  received: OriginParts,
  entry: RequestEntry | null,
): OriginMismatchReason {
  if (received.scheme !== "https" || entry === null) return "scheme_mismatch";
  if (entry.reportedProtocol !== "https") return "scheme_not_forwarded";

  return entry.isTrustedProxy ? "scheme_mismatch" : "scheme_proxy_untrusted";
}

function classifyMismatch(
  expected: OriginParts | null,
  received: OriginParts | null,
  entry: RequestEntry | null,
): OriginMismatchReason {
  if (expected === null || received === null) return "origin_unreadable";
  if (expected.host !== received.host) return "host_mismatch";
  if (expected.scheme === received.scheme) return "port_mismatch";

  return classifySchemeMismatch(received, entry);
}

/**
 * Compares the `Origin` of a request with the public origin of Pages.
 *
 * @param request - The request as the entrance of the server built it.
 * @param entry - How the request arrived, from {@link requestEntryContext}.
 * @returns `null` when the request names no origin or its own, otherwise the
 * facts of the refusal.
 *
 * @remarks
 * The public origin is the address of the request URL: the `Host` header and
 * the protocol of the connection, or `https` when a trusted proxy forwarded
 * it from HTTPS. The browser's `Origin` is never a basis for it, only the
 * thing compared with it, and the comparison is exact. The classification
 * only decides which error the person sees and what the log explains; it
 * never lets a request through.
 */
export function assessRequestOrigin(
  request: Request,
  entry: RequestEntry | null,
): OriginRefusal | null {
  const origin = request.headers.get("Origin");
  const expectedOrigin = new URL(request.url).origin;

  if (origin === null || origin === expectedOrigin) return null;

  const expected = readOriginParts(expectedOrigin);
  const received = readOriginParts(origin);
  const fetchSite = readFetchSite(request);

  return {
    code: isForwardingArtifact(fetchSite, entry)
      ? "originRejected"
      : "accessDenied",
    reason: classifyMismatch(expected, received, entry),
    expectedOrigin: formatOrigin(expected),
    receivedOrigin: formatOrigin(received),
    forwardedProtocol: entry?.reportedProtocol ?? "unknown",
    isTrustedProxy: entry?.isTrustedProxy ?? false,
    fetchSite,
  };
}

/** Takes one event from the budget of the current minute; `null` when it is spent. */
function claimLogSlot(now: number): number | null {
  let lost = 0;

  if (now - logBudget.windowStartedAt >= LOG_WINDOW_MS) {
    lost = logBudget.suppressed;
    logBudget.windowStartedAt = now;
    logBudget.logged = 0;
    logBudget.suppressed = 0;
  }

  if (logBudget.logged >= MAXIMUM_LOGGED_PER_WINDOW) {
    logBudget.suppressed += 1;

    return null;
  }

  logBudget.logged += 1;

  return lost;
}

/**
 * Records why a request was refused, so a returning refusal can be traced.
 *
 * @param refusal - The facts from {@link assessRequestOrigin}.
 * @param route - A fixed label of the route, never a path taken from a client.
 *
 * @remarks
 * The event carries the correlation of the request from the log context, the
 * route, the category and the normalized scheme, host and port of both
 * origins. It carries no header dump, cookie, token, address of a peer, body
 * or session fact. At most 20 events are written per minute; the first event
 * of the next minute says how many were left out.
 */
export function logOriginRefusal(refusal: OriginRefusal, route: string): void {
  const lost = claimLogSlot(Date.now());

  if (lost === null) return;

  logEvent({
    level: "warn",
    event: "request.origin.rejected",
    component: "OriginGuard",
    message:
      "The Origin of a request does not match the public origin of Pages",
    metadata: {
      route,
      code: refusal.code,
      reason: refusal.reason,
      expectedOrigin: refusal.expectedOrigin,
      receivedOrigin: refusal.receivedOrigin,
      forwardedProtocol: refusal.forwardedProtocol,
      isTrustedProxy: refusal.isTrustedProxy,
      fetchSite: refusal.fetchSite,
      ...(lost > 0 ? { lost } : {}),
    },
  });
}
