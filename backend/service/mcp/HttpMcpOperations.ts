import { createOperationsServer } from "@/mcp/src/operations-server";
import { operationFailure } from "@/mcp/src/tools/operation-failure";
import { AgentOperationError } from "@/backend/error/AgentOperationError";

import type { PagesAgentApiService } from "@/backend/service/PagesAgentApiService";
import type { McpServer } from "@modelcontextprotocol/server";

/** Uses the same external catalog and projection while dispatching directly to the existing service. */
export function createHttpMcpServer(
  api: PagesAgentApiService,
  token: string,
): McpServer {
  return createOperationsServer({
    verify: async () => {
      const response = await api.handle(token, { operation: "verify" });
      if (!("tools" in response))
        throw new Error("Pages authorization failed.");
      return { tools: response.tools };
    },
    names: async () => {
      const response = await api.handle(token, {
        operation: "projects.names.list",
        parameters: {},
      });
      if (!("projectNames" in response))
        throw new Error("Pages authorization failed.");
      return [...response.projectNames];
    },
    read: async (operation, parameters) => {
      try {
        const response = await api.handle(token, { operation, parameters });
        if (
          !("result" in response) ||
          typeof response.result !== "object" ||
          response.result === null
        )
          throw new Error("Pages operation failed.");
        return response.result as Record<string, unknown>;
      } catch (error: unknown) {
        if (error instanceof AgentOperationError) {
          const failure = await operationFailure(
            Response.json(
              {
                apiVersion: "1",
                error: { code: error.code, details: error.details },
              },
              { status: error.status },
            ),
          );
          if (failure) throw failure;
        }
        throw new Error("Pages authorization failed.");
      }
    },
  });
}
