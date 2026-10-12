import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { readConfiguration } from "./configuration.js";
import { CredentialStoreError } from "./credential-store.js";
import { runCredentialCommand } from "./credential-command.js";
import { readStdioConfiguration } from "./stdio-configuration.js";
import { createServer } from "./server.js";
import { verifyPages } from "./verification.js";
import {
  HttpOptionError,
  readHttpConfiguration,
} from "./http-configuration.js";
import { startHttpServer } from "./http-server.js";

/** Starts stdio after validation; all unexpected diagnostics are fixed, token-free text. */
export async function start(): Promise<void> {
  try {
    const argumentsList = process.argv.slice(2);
    if (["pair", "rotate", "unpair", "status"].includes(argumentsList[0])) {
      process.exitCode = await runCredentialCommand(argumentsList, process.env);
      return;
    }
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
    const configuration =
      process.env.PAGES_TOKEN !== undefined
        ? readConfiguration(process.env)
        : await readStdioConfiguration(process.env);
    await verifyPages(configuration);
    serveStdio(() => createServer(() => configuration));
  } catch (error: unknown) {
    console.error(
      error instanceof HttpOptionError || error instanceof CredentialStoreError
        ? `[pages-mcp] ${error.message}`
        : "[pages-mcp] Startup failed. Check PAGES_URL, PAGES_TOKEN (stdio), HTTP options and Pages authorization.",
    );
    process.exitCode = 1;
  }
}
