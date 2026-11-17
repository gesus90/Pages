import {
  mcpPlanBodyRequest,
  mcpPlanResponse,
  requireMcpPlanParameter,
  runMcpPlanRoute,
} from "@/app/lib/mcp-plan-route.server";

import type { McpPlanHandlers } from "@/app/lib/mcp-plan-route.server";
import type { Route } from "./+types/api-mcp-v1-plan-workspace-lock-release";

function handlers(params: Route.LoaderArgs["params"]): McpPlanHandlers {
  return {
    POST: async ({ api, identity, request }) =>
      mcpPlanResponse(
        await api.run(
          identity,
          "plans.workspace_locks.release",
          await mcpPlanBodyRequest(request, {
            planId: requireMcpPlanParameter(params.planId),
            runId: requireMcpPlanParameter(params.runId),
          }),
        ),
      ),
  };
}

/** Admits only paired-device POST requests; never interprets browser cookies as release permission. */
export async function loader({
  params,
  request,
}: Route.LoaderArgs): Promise<Response> {
  return runMcpPlanRoute(request, handlers(params));
}

/** Releases an ended run's reservations through the current holder plan's authorization and writer checks. */
export async function action({
  params,
  request,
}: Route.ActionArgs): Promise<Response> {
  return runMcpPlanRoute(request, handlers(params));
}
