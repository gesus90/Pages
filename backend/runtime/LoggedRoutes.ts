import { logEvent } from "@/backend/logging/Logger";
import { isPollingLogContext } from "@/backend/logging/PollingLogPolicy";
import {
  recordRouteEnd,
  recordRouteStart,
} from "@/backend/logging/RouteLogMetrics";

import type { ActionFunction, LoaderFunction, ServerBuild } from "react-router";

function wrapHandler(
  handler: LoaderFunction | ActionFunction | undefined,
  routeId: string,
  kind: "loader" | "action",
): LoaderFunction | undefined {
  if (!handler) return undefined;
  return async (args, handlerContext) => {
    const started = performance.now();
    if (!recordRouteStart(kind))
      logEvent({
        level: "debug",
        event: `route.${kind}.started`,
        component: "Routes",
        message: "Route handler started",
        metadata: { route: routeId, kind },
      });
    try {
      const result = await handler(args, handlerContext);
      if (!recordRouteEnd(routeId, performance.now() - started, "completed"))
        logEvent({
          level: "info",
          event: `route.${kind}.completed`,
          component: "Routes",
          message: "Route handler completed",
          metadata: {
            route: routeId,
            kind,
            durationMs: performance.now() - started,
          },
        });
      return result;
    } catch (error: unknown) {
      recordRouteEnd(
        routeId,
        performance.now() - started,
        error instanceof Response && error.status < 500
          ? "completed"
          : "failed",
      );
      if (error instanceof Response && error.status < 500) {
        if (error.status >= 400 || !isPollingLogContext())
          logEvent({
            level: "info",
            event: "route.response",
            component: "Routes",
            message: "Route returned a control response",
            metadata: { route: routeId, statusCode: error.status, kind },
          });
      } else {
        logEvent({
          level: "error",
          event: `route.${kind}.failed`,
          component: "Routes",
          message: "Route handler failed",
          error,
          metadata: {
            route: routeId,
            kind,
            durationMs: performance.now() - started,
          },
        });
      }
      throw error;
    }
  };
}

/** Instruments every registered production loader/action without reading its arguments or result. */
export function withLoggedRoutes(build: ServerBuild): ServerBuild {
  if (Object.keys(build.routes).length === 0) return build;
  const routes: ServerBuild["routes"] = {};
  for (const [id, route] of Object.entries(build.routes)) {
    if (!route) continue;
    routes[id] = {
      ...route,
      module: {
        ...route.module,
        loader: wrapHandler(route.module.loader, id, "loader"),
        action: wrapHandler(route.module.action, id, "action"),
      },
    };
  }
  return { ...build, routes };
}
