import { fileURLToPath } from "node:url";

import * as build from "virtual:react-router/server-build";

import { startPagesServer } from "./PagesServer";

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
export function startServer(argumentList: readonly string[]): Promise<number> {
  return startPagesServer({
    argumentList,
    build,
    clientDirectory: fileURLToPath(new URL("../client", import.meta.url)),
  });
}
