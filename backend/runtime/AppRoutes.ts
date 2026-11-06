import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { logFileProbeError } from "@/backend/logging/Logger";

import { isForwardedRoute } from "./AppRouteMatch";

import type { AppRoute } from "./AppRouteMatch";

/**
 * Route list the static app's build writes next to its files (PAGE-235).
 *
 * @remarks
 * The name starts with a dot, so the static file handler never serves it.
 * `vite.config.ts` writes it from `app/routes.ts`.
 */
export const APP_ROUTES_FILE = ".pages-routes.json";

function isAppRoute(value: unknown): value is AppRoute {
  return (
    typeof value === "object" &&
    value !== null &&
    "path" in value &&
    typeof value.path === "string" &&
    "isForwarded" in value &&
    typeof value.isForwarded === "boolean"
  );
}

/**
 * Reads the route list of the static app.
 *
 * @param clientDirectory - Absolute path of the static app's files.
 * @returns The routes, or `null` when the build wrote none.
 */
async function readRouteList(
  clientDirectory: string,
): Promise<readonly AppRoute[] | null> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(path.join(clientDirectory, APP_ROUTES_FILE), "utf8"),
    );
    return Array.isArray(parsed) && parsed.every(isAppRoute) ? parsed : null;
  } catch (error: unknown) {
    logFileProbeError("AppRoutes", error);
    return null;
  }
}

/**
 * Decides who answers a request: the static app's document or the API.
 *
 * @remarks
 * Reads the build's route list again when it changed on disk, so a new
 * build of the app is followed without a restart.
 */
export class AppRoutes {
  private readonly clientDirectory: string;
  private routes: readonly AppRoute[] | null = null;
  private routesModifiedAt = -1;

  /**
   * @param clientDirectory - Absolute path of the static app's files.
   */
  public constructor(clientDirectory: string) {
    this.clientDirectory = clientDirectory;
  }

  /**
   * Whether the API answers a request, rather than the app's document.
   *
   * @param method - The request method.
   * @param pathname - The request path, decoded.
   * @returns `true` for changes, data requests and server resources, and
   * for every request while the build lists no routes.
   */
  public async isForwarded(method: string, pathname: string): Promise<boolean> {
    const routes = await this.currentRoutes();
    return routes === null || isForwardedRoute(routes, method, pathname);
  }

  private async currentRoutes(): Promise<readonly AppRoute[] | null> {
    const file = path.join(this.clientDirectory, APP_ROUTES_FILE);
    let modifiedAt: number;
    try {
      modifiedAt = (await stat(file)).mtimeMs;
    } catch (error: unknown) {
      logFileProbeError("AppRoutes", error);
      return null;
    }
    if (modifiedAt !== this.routesModifiedAt) {
      this.routes = await readRouteList(this.clientDirectory);
      this.routesModifiedAt = modifiedAt;
    }
    return this.routes;
  }
}
