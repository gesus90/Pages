import {
  mcpPlanReadHandlers,
  requireMcpPlanParameter,
  runMcpPlanRoute,
} from "@/app/lib/mcp-plan-route.server";

import type { Route } from "./+types/api-mcp-v1-plan-run-events";

/**
 * `GET /api/mcp/v1/plan-runs/{runId}/steps/{stepId}/attempts/{attemptId}/events`, the tool `read_plan_run_session_events` (PAGE-307).
 *
 * @remarks
 * Only the device token of a paired machine admits a request. The answer is
 * the `result` of the operation `plans.run.session.events.read`, with the rights of the account.
 */
export async function loader({
  params,
  request,
}: Route.LoaderArgs): Promise<Response> {
  return runMcpPlanRoute(
    request,
    mcpPlanReadHandlers("plans.run.session.events.read", () => ({
      runId: requireMcpPlanParameter(params.runId),
      stepId: requireMcpPlanParameter(params.stepId),
      attemptId: requireMcpPlanParameter(params.attemptId),
    })),
  );
}
