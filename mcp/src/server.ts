import { McpServer } from "@modelcontextprotocol/server";

import manifest from "../package.json" with { type: "json" };

/** Creates a protocol-only server whose tool list is explicitly empty. */
export function createServer(): McpServer {
  const server = new McpServer(
    { name: "pages-mcp", version: manifest.version },
    { capabilities: { tools: {} } },
  );
  server.server.setRequestHandler("tools/list", () => ({ tools: [] }));
  return server;
}
