import { resolveDefaultConfigPath } from "@/backend/config/PagesConfig";
import { logCaughtError, initializeLogging } from "@/backend/logging/Logger";

import { installProcessLogging, shutdownProcess } from "./ProcessLifecycle";
import { startAgentTools } from "./AgentToolsStartup";
import { announceServer } from "./PagesServer";
import { initializePagesRuntime } from "./PagesRuntime";
import { logRequest } from "./RequestLogging";

import type { IncomingMessage, ServerResponse } from "node:http";

/** Connect-compatible bridge installed in the same SSR module graph as the runtime. */
export type DevelopmentRequestLogger = (
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
) => void;

/**
 * Initializes the runtime inside the development server.
 *
 * @param serverUrls - Addresses the development server listens on, as
 * reported by Vite, for example `http://localhost:5173/`.
 *
 * @remarks
 * The development server is not started through `server.mjs`, so a Vite
 * plugin calls this once it listens. It reads `~/.pages/config.toml` like
 * the production server and prints the setup link to stdout with the actual port.
 * Start parameters and the configured port do not apply here.
 */
export async function startDevelopmentRuntime(
  serverUrls: readonly string[],
  installRequests?: (listener: DevelopmentRequestLogger) => void,
): Promise<void> {
  installProcessLogging();
  try {
    await initializeLogging(resolveDefaultConfigPath());
    const runtime = await initializePagesRuntime(resolveDefaultConfigPath());
    installRequests?.((request, response, next) =>
      logRequest(request, response, next),
    );

    void startAgentTools(runtime);
    announceServer(
      runtime,
      serverUrls.map((url) => url.replace(/\/$/u, "")),
    );
  } catch (error: unknown) {
    logCaughtError("DevelopmentRuntime", error);

    await shutdownProcess(1, "development_startup", error);
  }
}
