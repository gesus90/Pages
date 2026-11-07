import {
  mcpPlanBodyRequest,
  mcpPlanQueryRequest,
  mcpPlanResponse,
  requireMcpPlanParameter,
  runMcpPlanRoute,
} from "@/app/lib/mcp-plan-route.server";

import type { McpPlanHandlers } from "@/app/lib/mcp-plan-route.server";
import type { Route } from "./+types/api-mcp-v1-plan-template";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpPlanHandlers {
  // Read inside the handler, so a missing parameter is answered after the token check.
  const path = (): Readonly<Record<string, string>> => ({
    templateId: requireMcpPlanParameter(params.templateId),
  });
  return {
    GET: async ({ api, identity, request }) =>
      mcpPlanResponse(
        await api.run(
          identity,
          "plans.templates.read",
          mcpPlanQueryRequest(request, path()),
        ),
      ),
    PATCH: async ({ api, identity, request }) =>
      mcpPlanResponse(
        await api.run(
          identity,
          "plans.templates.update",
          await mcpPlanBodyRequest(request, path()),
        ),
      ),
  };
}

/**
 * Reads a node template (`GET /api/mcp/v1/plan-templates/{templateId}`) and renames or replaces it (`PATCH`), PAGE-246 interface 14 and 16.
 *
 * @remarks
 * Only the device token of a paired machine admits a request.
 */
export async function loader({
  params,
  request,
}: Route.LoaderArgs): Promise<Response> {
  return runMcpPlanRoute(request, handlers(params));
}

/** Serves the changing methods of the same resource. */
export async function action({
  params,
  request,
}: Route.ActionArgs): Promise<Response> {
  return runMcpPlanRoute(request, handlers(params));
}
