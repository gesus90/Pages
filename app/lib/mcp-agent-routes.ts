import type { RouteConfigEntry } from "@react-router/dev/routes";

/**
 * The agent API of the stand-alone Pages MCP program, admitted by the device
 * token of an administrator (PAGE-267).
 *
 * @param resource - Declares a server resource of the current route table.
 * @returns The resources under `/api/mcp/v1/agents`.
 */
export function mcpAgentRoutes(
  resource: (path: string, file: string) => RouteConfigEntry,
): RouteConfigEntry[] {
  const agents = "api/mcp/v1/agents";
  const agent = `${agents}/:id`;
  const versions = `${agent}/memory/versions`;
  return [
    resource(agents, "routes/api-mcp-v1-agents.ts"),
    resource(`${agents}/options`, "routes/api-mcp-v1-agents-options.ts"),
    resource(agent, "routes/api-mcp-v1-agent.ts"),
    resource(`${agent}/image`, "routes/api-mcp-v1-agent-image.ts"),
    resource(`${agent}/remove`, "routes/api-mcp-v1-agent-remove.ts"),
    resource(versions, "routes/api-mcp-v1-agent-memory-versions.ts"),
    resource(
      `${versions}/:versionId/restore`,
      "routes/api-mcp-v1-agent-memory-version-restore.ts",
    ),
    resource(
      `${agent}/memory/archive`,
      "routes/api-mcp-v1-agent-memory-archive.ts",
    ),
    resource(`${agent}/activity`, "routes/api-mcp-v1-agent-activity.ts"),
  ];
}
