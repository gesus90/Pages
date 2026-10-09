import {
  McpServer,
  ProtocolError,
  ProtocolErrorCode,
} from "@modelcontextprotocol/server";

import manifest from "../package.json" with { type: "json" };
import { listProjectNames } from "./project-names.js";
import { verifyPages } from "./verification.js";

import type { PagesConfiguration } from "./configuration.js";

const LIST_PROJECT_NAMES_TOOL = {
  name: "list_project_names",
  title: "List project names",
  description:
    "Lists the names of the Pages projects the connected account may see. Returns names only, without identifiers, descriptions or content.",
  inputSchema: { type: "object", additionalProperties: false },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;

/** Maps any Pages failure to one fixed message, so neither credentials nor details leak. */
async function authorized<Result>(
  request: () => Promise<Result>,
): Promise<Result> {
  try {
    return await request();
  } catch {
    throw new Error("Pages authorization failed.");
  }
}

/**
 * Creates the server exposing exactly the project-name listing.
 * Pages verifies and authorizes every list and call anew with the configuration
 * resolved for that request; the list only contains what Pages currently allows.
 */
export function createServer(resolve: () => PagesConfiguration): McpServer {
  const server = new McpServer(
    { name: "pages-mcp", version: manifest.version },
    { capabilities: { tools: {} } },
  );
  server.server.setRequestHandler("tools/list", async () => {
    const { tools } = await authorized(() => verifyPages(resolve()));
    return {
      tools: tools.includes("projects.names.list")
        ? [LIST_PROJECT_NAMES_TOOL]
        : [],
    };
  });
  server.server.setRequestHandler("tools/call", async (request) => {
    if (request.params.name !== LIST_PROJECT_NAMES_TOOL.name) {
      await authorized(() => verifyPages(resolve()));
      throw new ProtocolError(ProtocolErrorCode.InvalidParams, "Unknown tool.");
    }
    if (Object.keys(request.params.arguments ?? {}).length > 0) {
      throw new ProtocolError(
        ProtocolErrorCode.InvalidParams,
        "This tool takes no arguments.",
      );
    }
    const projectNames = await authorized(() => listProjectNames(resolve()));
    return {
      content: [{ type: "text", text: JSON.stringify(projectNames) }],
    };
  });
  return server;
}
