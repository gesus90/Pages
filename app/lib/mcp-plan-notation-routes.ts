import type { RouteConfigEntry } from "@react-router/dev/routes";

/**
 * The plan notation API of the stand-alone Pages MCP program, admitted by the
 * device token (PAGE-250).
 *
 * @param resource - Declares a server resource of the current route table.
 * @returns The plan notation resources.
 */
export function mcpPlanNotationRoutes(
  resource: (path: string, file: string) => RouteConfigEntry,
): RouteConfigEntry[] {
  const notation = "api/mcp/v1/plan-notation";
  return [
    resource(notation, "routes/api-mcp-v1-plan-notation.ts"),
    resource(`${notation}/check`, "routes/api-mcp-v1-plan-notation-check.ts"),
    resource(`${notation}/:planId`, "routes/api-mcp-v1-plan-notation-plan.ts"),
    resource(
      `${notation}/:planId/layout`,
      "routes/api-mcp-v1-plan-notation-layout.ts",
    ),
  ];
}
