import type { RouteConfigEntry } from "@react-router/dev/routes";

/**
 * The automation API of the Pages MCP client, admitted by the device token
 * of the existing pairing (PAGE-297).
 *
 * @param resource - Declares a server resource of the current route table.
 * @returns The resources under `/api/mcp/v1/automations`; the static
 * `/options` is never read as an automation ID.
 */
export function mcpAutomationRoutes(
  resource: (path: string, file: string) => RouteConfigEntry,
): RouteConfigEntry[] {
  const automations = "api/mcp/v1/automations";
  const automation = `${automations}/:automationId`;
  return [
    resource(automations, "routes/api-mcp-v1-automations.ts"),
    resource(
      `${automations}/options`,
      "routes/api-mcp-v1-automations-options.ts",
    ),
    resource(automation, "routes/api-mcp-v1-automation.ts"),
    resource(`${automation}/active`, "routes/api-mcp-v1-automation-active.ts"),
    resource(`${automation}/run`, "routes/api-mcp-v1-automation-run.ts"),
    resource(`${automation}/delete`, "routes/api-mcp-v1-automation-delete.ts"),
    resource(`${automation}/runs`, "routes/api-mcp-v1-automation-runs.ts"),
    resource(
      `${automation}/runs/:runId`,
      "routes/api-mcp-v1-automation-run-read.ts",
    ),
  ];
}
