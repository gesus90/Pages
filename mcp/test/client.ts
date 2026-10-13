import { createInterface } from "node:readline";

import manifest from "../package.json" with { type: "json" };
import {
  startServer,
  stopServer,
  StdioCheckError,
  withDeadline,
} from "./server.ts";

import type { Interface } from "node:readline";
import type { RunningServer } from "./server.ts";

const PROTOCOL_VERSION = "2025-11-25";
const REQUEST_TIMEOUT_MS = 15_000;

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function readMessage(line: string): Record<string, unknown> {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    throw new StdioCheckError("Server stdout contains non-protocol output.");
  }
  if (!isRecord(message) || message.jsonrpc !== "2.0") {
    throw new StdioCheckError(
      "Server stdout contains an invalid MCP envelope.",
    );
  }
  return message;
}

function requireNotification(message: Record<string, unknown>): void {
  if (
    typeof message.method !== "string" ||
    "id" in message ||
    "result" in message ||
    "error" in message ||
    ("params" in message && !isRecord(message.params))
  ) {
    throw new StdioCheckError("Server sent an unexpected MCP message.");
  }
}

/** Sequential stdio peer for this one acceptance flow; results never enter diagnostics. */
class StdioClient {
  private readonly server: RunningServer;
  private readonly reader: Interface;
  private readonly lines: AsyncIterableIterator<string>;
  private requestId = 0;
  private hasCompleteFrame = true;
  private streamFailure: StdioCheckError | null = null;

  public constructor(server: RunningServer) {
    this.server = server;
    this.reader = createInterface({
      input: server.child.stdout,
      crlfDelay: Infinity,
    });
    this.lines = this.reader[Symbol.asyncIterator]();
    server.child.stdout.on("data", (chunk: Buffer) => {
      this.hasCompleteFrame = chunk[chunk.length - 1] === 10;
    });
    const failStream = (): void => {
      this.streamFailure = new StdioCheckError(
        "The stdio pipe failed. Check that isolated Pages is reachable and the credential is valid.",
      );
    };
    server.child.stdin.on("error", failStream);
    server.child.stdout.on("error", failStream);
  }

  /** Sends one request, accepts valid notifications and validates its matching response. */
  public async request(
    method: string,
    parameters: Record<string, unknown>,
  ): Promise<unknown> {
    const id = ++this.requestId;
    await this.send({ jsonrpc: "2.0", id, method, params: parameters });
    return withDeadline(
      this.readResponse(id),
      REQUEST_TIMEOUT_MS,
      "Timed out waiting for an MCP response from the real bundle.",
    );
  }

  /** Announces initialization without expecting a JSON-RPC response. */
  public async initialized(): Promise<void> {
    await this.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  }

  /** Ends stdin, checks all remaining stdout frames and requires a clean server exit. */
  public async finish(): Promise<void> {
    this.server.child.stdin.end();
    const exit = await withDeadline(
      this.server.closed,
      5000,
      "Server did not exit after stdin closed.",
    );
    for await (const line of this.lines) requireNotification(readMessage(line));
    if (!this.hasCompleteFrame || this.streamFailure) {
      throw (
        this.streamFailure ??
        new StdioCheckError("Server stdout ended with an incomplete MCP frame.")
      );
    }
    if (exit.hasStartFailed || exit.code !== 0 || exit.signal !== null) {
      throw new StdioCheckError(
        "The real MCP bundle did not exit successfully.",
      );
    }
  }

  /** Releases the local line reader when either acceptance or cleanup finishes. */
  public dispose(): void {
    this.reader.close();
  }

  private async send(message: Record<string, unknown>): Promise<void> {
    if (this.streamFailure) throw this.streamFailure;
    await new Promise<void>((resolve, reject) => {
      this.server.child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
        if (error)
          reject(
            new StdioCheckError(
              "Could not send an MCP message to the real bundle.",
            ),
          );
        else resolve();
      });
    });
  }

  private async readResponse(id: number): Promise<unknown> {
    while (true) {
      const next = await this.lines.next();
      if (next.done) break;
      if (this.streamFailure) throw this.streamFailure;
      const message = readMessage(next.value);
      if ("method" in message) {
        requireNotification(message);
        continue;
      }
      if (message.id !== id || !("result" in message) || "error" in message) {
        throw new StdioCheckError(
          "The real bundle returned an MCP error or an invalid response.",
        );
      }
      return message.result;
    }
    throw new StdioCheckError(
      "The MCP bundle closed before answering. Check isolated Pages reachability and credential validity.",
    );
  }
}

function requireInitialization(result: unknown): void {
  if (
    !isRecord(result) ||
    result.protocolVersion !== PROTOCOL_VERSION ||
    !isRecord(result.serverInfo) ||
    result.serverInfo.name !== "pages-mcp" ||
    result.serverInfo.version !== manifest.version ||
    !isRecord(result.capabilities) ||
    !isRecord(result.capabilities.tools)
  ) {
    throw new StdioCheckError(
      "initialize returned an invalid server identity, protocol version or tools capability.",
    );
  }
}

function requireReadTool(result: unknown): void {
  if (
    !isRecord(result) ||
    !Array.isArray(result.tools) ||
    result.nextCursor !== undefined ||
    !result.tools.every(
      (tool: unknown) =>
        isRecord(tool) &&
        typeof tool.name === "string" &&
        isRecord(tool.inputSchema) &&
        tool.inputSchema.type === "object",
    )
  ) {
    throw new StdioCheckError(
      "tools/list returned an invalid or incomplete tool list.",
    );
  }
  const tool: unknown = result.tools.find(
    (entry: unknown) => isRecord(entry) && entry.name === "list_project_names",
  );
  if (
    !isRecord(tool) ||
    !isRecord(tool.annotations) ||
    tool.annotations.readOnlyHint !== true ||
    tool.annotations.destructiveHint !== false
  ) {
    throw new StdioCheckError(
      "The isolated account does not offer the read-only list_project_names tool.",
    );
  }
}

function requireProjectNames(result: unknown): void {
  if (
    !isRecord(result) ||
    (result.isError !== undefined && result.isError !== false) ||
    !Array.isArray(result.content) ||
    result.content.length !== 1
  ) {
    throw new StdioCheckError(
      "The read-only tool call returned an error or invalid content.",
    );
  }
  const content: unknown = result.content[0];
  if (
    !isRecord(content) ||
    content.type !== "text" ||
    typeof content.text !== "string"
  ) {
    throw new StdioCheckError(
      "The read-only tool call did not return text content.",
    );
  }
  let names: unknown;
  try {
    names = JSON.parse(content.text);
  } catch {
    throw new StdioCheckError("The read-only tool call returned invalid JSON.");
  }
  if (
    !Array.isArray(names) ||
    !names.every((name: unknown) => typeof name === "string")
  ) {
    throw new StdioCheckError(
      "The read-only tool call did not return a project-name array.",
    );
  }
}

async function run(): Promise<void> {
  const server = await startServer();
  const client = new StdioClient(server);
  try {
    requireInitialization(
      await client.request("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: "pages-mcp-stdio-check",
          version: manifest.version,
        },
      }),
    );
    await client.initialized();
    requireReadTool(await client.request("tools/list", {}));
    requireProjectNames(
      await client.request("tools/call", {
        name: "list_project_names",
        arguments: {},
      }),
    );
    await client.finish();
    console.error(
      "[pages-mcp test] Passed: initialize, initialized, tools/list, read-only call, protocol-only stdout and server exit 0.",
    );
  } finally {
    client.dispose();
    await stopServer(server);
  }
}

try {
  await run();
} catch (error: unknown) {
  console.error(
    `[pages-mcp test] Failed: ${error instanceof StdioCheckError ? error.message : "Unexpected stdio check failure; no provider response or credential has been logged."}`,
  );
  process.exitCode = 1;
}
