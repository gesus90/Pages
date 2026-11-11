import {
  mcpPlanReadHandlers,
  requireMcpPlanParameter,
  runMcpPlanRoute,
} from "@/app/lib/mcp-plan-route.server";

import type { Route } from "./+types/api-mcp-v1-plan-runs";

/**
 * `GET /api/mcp/v1/plans/{planId}/runs`, the tool `list_plan_runs` (PAGE-307).
 *
 * @remarks
 * Only the device token of a paired machine admits a request. The answer is
 * the `result` of the operation `plans.runs.list`, with the rights of the account.
 */
export async function loader({
  params,
  request,
}: Route.LoaderArgs): Promise<Response> {
  return runMcpPlanRoute(
    request,
    mcpPlanReadHandlers("plans.runs.list", () => ({
      planId: requireMcpPlanParameter(params.planId),
    })),
  );
}
