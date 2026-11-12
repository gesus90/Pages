import {
  mcpPlanReadHandlers,
  requireMcpPlanParameter,
  runMcpPlanRoute,
} from "@/app/lib/mcp-plan-route.server";

import type { Route } from "./+types/api-mcp-v1-plan-run-checkpoint";

/**
 * `GET /api/mcp/v1/plan-runs/{runId}/checkpoint`, the tool `read_plan_run_checkpoint` (PAGE-307).
 *
 * @remarks
 * Only the device token of a paired machine admits a request. The answer is
 * the `result` of the operation `plans.run.checkpoint.read`, with the rights of the account.
 */
export async function loader({
  params,
  request,
}: Route.LoaderArgs): Promise<Response> {
  return runMcpPlanRoute(
    request,
    mcpPlanReadHandlers("plans.run.checkpoint.read", () => ({
      runId: requireMcpPlanParameter(params.runId),
    })),
  );
}
