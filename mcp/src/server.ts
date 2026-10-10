import {
  McpServer,
  ProtocolError,
  ProtocolErrorCode,
} from "@modelcontextprotocol/server";

import manifest from "../package.json" with { type: "json" };
import { listProjectNames } from "./project-names.js";
import { READ_TOOLS } from "./tools/registry.js";
import { readOperation } from "./tools/read-operation.js";
import { PagesOperationFailure } from "./tools/operation-failure.js";
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
 * Creates the server exposing project names and the A9.5 read tools.
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
      tools: [
        ...(tools.includes("projects.names.list")
          ? [LIST_PROJECT_NAMES_TOOL]
          : []),
        ...READ_TOOLS.filter((entry) => tools.includes(entry.operation)).map(
          (entry) => entry.tool,
        ),
      ],
    };
  });
  server.server.setRequestHandler("tools/call", async (request) => {
    const readTool = READ_TOOLS.find(
      (entry) => entry.tool.name === request.params.name,
    );
    if (readTool) {
      const configuration = await authorized(async () => resolve());
      const verification = await authorized(() => verifyPages(configuration));
      if (!verification.tools.includes(readTool.operation))
        throw new Error("Pages authorization failed.");
      try {
        const result = await readOperation(
          configuration,
          readTool.operation,
          request.params.arguments ?? {},
        );
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (error: unknown) {
        if (error instanceof PagesOperationFailure)
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  code: error.code,
                  ...(error.details === undefined
                    ? {}
                    : { details: error.details }),
                }),
              },
            ],
          };
        throw new Error("Pages authorization failed.");
      }
    }
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
