import {
  mcpPlanReadHandlers,
  requireMcpPlanParameter,
  runMcpPlanRoute,
} from "@/app/lib/mcp-plan-route.server";

import type { Route } from "./+types/api-mcp-v1-plan-run-reports";

/**
 * `GET /api/mcp/v1/plan-runs/{runId}/reports`, the tool `read_plan_run_reports` (PAGE-307).
 *
 * @remarks
 * Only the device token of a paired machine admits a request. The answer is
 * the `result` of the operation `plans.run.reports.read`, with the rights of the account.
 */
export async function loader({
  params,
  request,
}: Route.LoaderArgs): Promise<Response> {
  return runMcpPlanRoute(
    request,
    mcpPlanReadHandlers("plans.run.reports.read", () => ({
      runId: requireMcpPlanParameter(params.runId),
    })),
  );
}
