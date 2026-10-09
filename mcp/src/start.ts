import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { readConfiguration } from "./configuration.js";
import { createServer } from "./server.js";

/** Starts stdio after validation; all unexpected diagnostics are fixed, token-free text. */
export function start(): void {
  try {
    readConfiguration(process.env);
  } catch (error: unknown) {
    // Only our configuration validator produces these messages.
    console.error(
      `[pages-mcp] ${error instanceof Error ? error.message : "Invalid configuration."}`,
    );
    process.exitCode = 1;
    return;
  }

  try {
    serveStdio(createServer);
  } catch {
    console.error("[pages-mcp] Could not start the stdio server.");
    process.exitCode = 1;
  }
}
