import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { readConfiguration } from "./configuration.js";
import { createServer } from "./server.js";
import { verifyPages } from "./verification.js";
import { readHttpConfiguration } from "./http-configuration.js";
import { startHttpServer } from "./http-server.js";

/** Starts stdio after validation; all unexpected diagnostics are fixed, token-free text. */
export async function start(): Promise<void> {
  try {
    const argumentsList = process.argv.slice(2);
    if (argumentsList.length > 0) {
      const server = await startHttpServer(
        readHttpConfiguration(process.env, argumentsList),
      );
      const shutdown = (): void => {
        server.close();
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
      return;
    }
    const configuration = readConfiguration(process.env);
    await verifyPages(configuration);
    serveStdio(() => createServer(() => verifyPages(configuration)));
  } catch {
    console.error(
      "[pages-mcp] Startup failed. Check PAGES_URL, PAGES_TOKEN (stdio), HTTP options and Pages authorization.",
    );
    process.exitCode = 1;
  }
}
