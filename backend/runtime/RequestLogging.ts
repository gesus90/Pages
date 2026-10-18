import { randomUUID } from "node:crypto";

import { withDatabaseLogMetrics } from "@/backend/logging/DatabaseLogMetrics";
import { withAccountAuthorizationLog } from "@/backend/logging/AccountAuthorizationLog";
import { withRouteLogMetrics } from "@/backend/logging/RouteLogMetrics";
import { logCaughtError, withLogContext } from "@/backend/logging/Logger";
import {
  isPollingRequest,
  withPollingLogPolicy,
} from "@/backend/logging/PollingLogPolicy";

import { RequestLogLifecycle } from "./RequestLogLifecycle";

import type { IncomingMessage, ServerResponse } from "node:http";

const ROUTE_SEGMENTS = new Set(
  "api v1 agent-assets agents pica-bridge pairing pair login logout setup health settings system profile connections resources definitions workspaces ticket-choices workspace-folders run-records plan-sources plan-runs recovery steps prompt session events dashboard users projekte aufgaben tasks wiki trash wiki-api ticket-api attachments drafts search references link-titles instance-logo agent-api agent-assets chat-api discord callback result settings-api account-version set-language change-password assets".split(
    " ",
  ),
);

/** Labels a route without ever recording query strings, opaque path identifiers or user text. */
export function safeRequestRoute(requestUrl: string): string {
  try {
    const pathname = new URL(
      requestUrl,
      "http://pages.invalid",
    ).pathname.replace(/\.data$/u, "");
    return pathname
      .split("/")
      .slice(0, 12)
      .map((segment) =>
        segment === "" || ROUTE_SEGMENTS.has(segment) ? segment : ":id",
      )
      .join("/");
  } catch (caughtError: unknown) {
    logCaughtError("RequestLogging", caughtError);

    return "/:invalid";
  }
}

/** Instruments request start, finish and disconnect with one isolated async context. */
export function logRequest(
  request: IncomingMessage,
  response: ServerResponse,
  handle: () => void,
): void {
  const requestId = randomUUID();
  const method = /^(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/u.test(
    request.method ?? "",
  )
    ? (request.method ?? "OTHER")
    : "OTHER";
  const url = request.url ?? "/";
  const isPolling = isPollingRequest(url, method);
  withLogContext({ requestId, correlationId: requestId }, () =>
    withPollingLogPolicy(isPolling, () =>
      withDatabaseLogMetrics((database) =>
        withRouteLogMetrics((routes) =>
          withAccountAuthorizationLog((confirmAuthorization) => {
            const lifecycle = new RequestLogLifecycle(
              { requestId, method, route: safeRequestRoute(url), isPolling },
              { database, routes },
              confirmAuthorization,
            );
            lifecycle.observe(response);
            handle();
          }),
        ),
      ),
    ),
  );
}
