import type { RouteConfigEntry } from "@react-router/dev/routes";

/** The workspace and remote connection API of the stand-alone Pages MCP program, admitted by the device token (PAGE-245). */
export function mcpWorkspaceRoutes(routes: {
  readonly resource: (path: string, file: string) => RouteConfigEntry;
}): RouteConfigEntry[] {
  const { resource } = routes;
  const workspaces = "api/mcp/v1/workspaces";
  const workspace = `${workspaces}/:id`;
  const connections = "api/mcp/v1/remote-connections";
  const connection = `${connections}/:id`;
  return [
    resource(workspaces, "routes/api-mcp-v1-workspaces.ts"),
    resource(`${workspaces}/folders`, "routes/api-mcp-v1-workspace-folders.ts"),
    resource(workspace, "routes/api-mcp-v1-workspace.ts"),
    resource(`${workspace}/check`, "routes/api-mcp-v1-workspace-check.ts"),
    resource(`${workspace}/usages`, "routes/api-mcp-v1-workspace-usages.ts"),
    resource(`${workspace}/remove`, "routes/api-mcp-v1-workspace-remove.ts"),
    resource(connections, "routes/api-mcp-v1-remote-connections.ts"),
    resource(
      `${connections}/test`,
      "routes/api-mcp-v1-remote-connection-test.ts",
    ),
    resource(connection, "routes/api-mcp-v1-remote-connection.ts"),
    resource(
      `${connection}/check`,
      "routes/api-mcp-v1-remote-connection-check.ts",
    ),
    resource(
      `${connection}/reconnect`,
      "routes/api-mcp-v1-remote-connection-reconnect.ts",
    ),
    resource(
      `${connection}/remove`,
      "routes/api-mcp-v1-remote-connection-remove.ts",
    ),
  ];
}
