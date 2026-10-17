import { fileURLToPath } from "node:url";

import * as build from "virtual:react-router/server-build";

import { parseStartOptions } from "@/backend/config/StartOptions";
import { resolveDefaultConfigPath } from "@/backend/config/PagesConfig";
import {
  logCaughtError,
  initializeLogging,
  closeLogging,
  logEvent,
} from "@/backend/logging/Logger";

import { startPagesServer } from "./PagesServer";
import { initializePagesRuntime } from "./PagesRuntime";
import { installProcessLogging, shutdownProcess } from "./ProcessLifecycle";

/**
 * Starts the production server with the application build it is part of.
 *
 * @param argumentList - Command-line arguments after the script name.
 * @returns The process exit code.
 *
 * @remarks
 * This module is the entry of the server build (`build/server/index.js`),
 * so the server, the runtime state, and the routes share one module graph.
 * `server.mjs` calls it.
 */
export async function startServer(
  argumentList: readonly string[],
): Promise<number> {
  installProcessLogging();
  try {
    const options = parseStartOptions(argumentList);
    const configPath = options.configPath ?? resolveDefaultConfigPath();
    await initializeLogging(configPath);
    await initializePagesRuntime(configPath);
    const result = await startPagesServer({
      argumentList,
      build,
      clientDirectory: fileURLToPath(new URL("../client", import.meta.url)),
    });
    if (result !== 0) await closeLogging();
    return result;
  } catch (error: unknown) {
    logCaughtError("ServerEntry", error);

    logEvent({
      level: "fatal",
      event: "server.start.failed",
      component: "ServerEntry",
      message: "Server could not start",
      error,
    });
    await shutdownProcess(1, "startup", error);
    return 1;
  }
}
