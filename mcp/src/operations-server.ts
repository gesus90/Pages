import {
  McpServer,
  ProtocolError,
  ProtocolErrorCode,
} from "@modelcontextprotocol/server";

import { TOOL_ENTRIES } from "./tools/tool-catalog.js";
import { READ_ANNOTATIONS } from "./tools/tool-definition.js";
import manifest from "../package.json" with { type: "json" };
import { CredentialStoreError } from "./credential-error.js";
import { PagesOperationError } from "./tools/operation-failure.js";

import type { McpToolOperation } from "./tools/tool-catalog.js";
import type { PagesAgentApiBusinessOperation } from "../../definition/PagesAgentApi.js";

/** Transport-independent access to the existing Pages operation contract. */
export interface McpOperations {
  /** Rechecks current identity and the operations Pages offers for this request. */
  verify(): Promise<{
    readonly tools: readonly PagesAgentApiBusinessOperation[];
  }>;
  /** Lists names of currently visible projects without their other fields. */
  names(): Promise<string[]>;
  /** Dispatches a registered read, comment or write operation through the transport boundary. */
  read(
    operation: McpToolOperation,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<Record<string, unknown>>;
}

const LIST_PROJECT_NAMES_TOOL = {
  name: "list_project_names",
  title: "List project names",
  description:
    "Lists the names of the Pages projects the connected account may see. Returns names only, without identifiers, descriptions or content.",
  inputSchema: { type: "object", additionalProperties: false },
  annotations: READ_ANNOTATIONS,
} as const;

/** Maps any Pages failure to one fixed message, so neither credentials nor details leak. */
async function authorized<Result>(
  request: () => Promise<Result>,
): Promise<Result> {
  try {
    return await request();
  } catch (error: unknown) {
    if (error instanceof CredentialStoreError) throw error;
    throw new Error("Pages authorization failed.");
  }
}

/** Registers exactly the same catalog, projections and failures for both external transports. */
export function createOperationsServer(operations: McpOperations): McpServer {
  const server = new McpServer(
    { name: "pages-mcp", version: manifest.version },
    { capabilities: { tools: {} } },
  );
  server.server.setRequestHandler("tools/list", async () => {
    const { tools } = await authorized(() => operations.verify());
    return {
      tools: [
        ...(tools.includes("projects.names.list")
          ? [LIST_PROJECT_NAMES_TOOL]
          : []),
        ...TOOL_ENTRIES.filter((entry) => tools.includes(entry.operation)).map(
          (entry) => entry.tool,
        ),
      ],
    };
  });
  server.server.setRequestHandler("tools/call", async (request) => {
    const registeredTool = TOOL_ENTRIES.find(
      (entry) => entry.tool.name === request.params.name,
    );
    if (registeredTool) {
      const verification = await authorized(() => operations.verify());
      if (!verification.tools.includes(registeredTool.operation))
        throw new Error("Pages authorization failed.");
      try {
        const result = await operations.read(
          registeredTool.operation,
          request.params.arguments ?? {},
        );
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (error: unknown) {
        if (error instanceof PagesOperationError)
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  code: error.code,
                  ...(error.code === "NOT_FOUND"
                    ? { message: error.message }
                    : {}),
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
      await authorized(() => operations.verify());
      throw new ProtocolError(ProtocolErrorCode.InvalidParams, "Unknown tool.");
    }
    if (Object.keys(request.params.arguments ?? {}).length > 0) {
      throw new ProtocolError(
        ProtocolErrorCode.InvalidParams,
        "This tool takes no arguments.",
      );
    }
    const projectNames = await authorized(() => operations.names());
    return {
      content: [{ type: "text", text: JSON.stringify(projectNames) }],
    };
  });
  return server;
}
