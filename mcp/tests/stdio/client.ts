import manifest from "../../package.json" with { type: "json" };
import { startServer, stopServer, StdioCheckError } from "./server.ts";
import { isRecord, PROTOCOL_VERSION, StdioClient } from "./stdio-client.ts";

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
