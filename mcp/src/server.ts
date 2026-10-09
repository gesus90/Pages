import { McpServer } from "@modelcontextprotocol/server";

import manifest from "../package.json" with { type: "json" };

import type { PagesAgentApiIdentity } from "../../definition/PagesAgentApi.js";

/** Creates a protocol-only server whose tool list is explicitly empty. */
export function createServer(
  verify: () => Promise<PagesAgentApiIdentity>,
): McpServer {
  const server = new McpServer(
    { name: "pages-mcp", version: manifest.version },
    { capabilities: { tools: {} } },
  );
  server.server.setRequestHandler("tools/list", async () => {
    try {
      await verify();
    } catch {
      throw new Error("Pages authorization failed.");
    }
    return { tools: [] };
  });
  server.server.setRequestHandler("tools/call", async () => {
    try {
      await verify();
    } catch {
      throw new Error("Pages authorization failed.");
    }
    throw new Error("No tool is available in this version.");
  });
  return server;
}
