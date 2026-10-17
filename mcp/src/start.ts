import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { CredentialStoreError } from "./credential-store.js";
import { runCredentialCommand } from "./credential-command.js";
import { readConfiguration } from "./configuration.js";
import { readStdioConfiguration } from "./stdio-configuration.js";
import { createServer } from "./server.js";
import { verifyPages } from "./verification.js";

/** Starts stdio after validation; all unexpected diagnostics are fixed, token-free text. */
export async function start(): Promise<void> {
  try {
    const argumentsList = process.argv.slice(2);
    if (argumentsList.length === 1 && argumentsList[0] === "health-check") {
      const configuration = readConfiguration({
        PAGES_URL: "http://127.0.0.1:1",
        PAGES_TOKEN: "pages-tool-health-probe",
      });
      serveStdio(() => createServer(() => configuration));
      return;
    }
    if (["pair", "rotate", "unpair", "status"].includes(argumentsList[0])) {
      process.exitCode = await runCredentialCommand(argumentsList, process.env);
      return;
    }
    if (argumentsList.length > 0) {
      console.error(
        "[pages-mcp] Unsupported startup argument. Pages MCP runs only over stdio: start without arguments, or use pair, status, rotate or unpair for credentials.",
      );
      process.exitCode = 1;
      return;
    }
    const configuration = await readStdioConfiguration(process.env);
    await verifyPages(configuration);
    serveStdio(() => createServer(() => configuration));
  } catch (error: unknown) {
    console.error(
      error instanceof CredentialStoreError
        ? `[pages-mcp] ${error.message}`
        : "[pages-mcp] Startup failed. Check PAGES_URL, PAGES_TOKEN or local pairing credentials and Pages authorization.",
    );
    process.exitCode = 1;
  }
}
