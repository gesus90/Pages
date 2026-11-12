import type { RouteConfigEntry } from "@react-router/dev/routes";

/**
 * The reads of runs for the whole team of a plan, admitted by the device token (PAGE-307).
 *
 * @param resource - Declares a server resource of the route table.
 */
export function mcpPlanRunRoutes(
  resource: (path: string, file: string) => RouteConfigEntry,
): RouteConfigEntry[] {
  const planRuns = "api/mcp/v1/plans/:planId/runs";
  const runs = "api/mcp/v1/plan-runs";
  const run = `${runs}/:runId`;
  return [
    resource(planRuns, "routes/api-mcp-v1-plan-runs.ts"),
    resource(`${planRuns}/latest`, "routes/api-mcp-v1-plan-run-latest.ts"),
    resource(`${planRuns}/first`, "routes/api-mcp-v1-plan-run-first.ts"),
    resource(runs, "routes/api-mcp-v1-plan-run-search.ts"),
    resource(`${runs}/failures`, "routes/api-mcp-v1-plan-run-failures.ts"),
    resource(run, "routes/api-mcp-v1-plan-run.ts"),
    resource(`${run}/reports`, "routes/api-mcp-v1-plan-run-reports.ts"),
    resource(
      `${run}/steps/:stepId/diagnostics`,
      "routes/api-mcp-v1-plan-run-diagnostics.ts",
    ),
    resource(
      `${run}/steps/:stepId/attempts/:attemptId/events`,
      "routes/api-mcp-v1-plan-run-events.ts",
    ),
    resource(`${run}/checkpoint`, "routes/api-mcp-v1-plan-run-checkpoint.ts"),
    resource(`${run}/recovery`, "routes/api-mcp-v1-plan-run-recovery.ts"),
    resource(`${run}/timeline`, "routes/api-mcp-v1-plan-run-timeline.ts"),
    resource(`${run}/logs`, "routes/api-mcp-v1-plan-run-logs.ts"),
  ];
}
