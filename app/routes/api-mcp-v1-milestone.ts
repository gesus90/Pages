import {
  mcpMilestoneBodyRequest,
  requireMcpMilestoneParameter,
  runMcpMilestoneRoute,
} from "@/app/lib/mcp-milestone-route.server";
import { mcpDeviceResponse } from "@/app/lib/mcp-device-response.server";

import type { McpMilestoneHandlers } from "@/app/lib/mcp-milestone-route.server";
import type { Route } from "./+types/api-mcp-v1-milestone";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpMilestoneHandlers {
  // Read inside the handler, so a missing parameter is answered after the token check.
  const path = (): Readonly<Record<string, string>> => ({
    milestoneId: requireMcpMilestoneParameter(params.milestoneId),
  });
  return {
    PATCH: async ({ api, identity, request }) =>
      mcpDeviceResponse(
        await api.changeField(
          identity,
          await mcpMilestoneBodyRequest(request, path),
        ),
      ),
  };
}

/**
 * Changes one field of a milestone (`PATCH /api/mcp/v1/milestones/{milestoneId}`)
 * with `{ operationId, field, expected, value }`; `field` is `name`,
 * `description`, `status`, `startAt` or `dueAt`.
 * @remarks
 * Only the device token of a paired machine admits a request.
 */
export async function loader({
  params,
  request,
}: Route.LoaderArgs): Promise<Response> {
  return runMcpMilestoneRoute(request, handlers(params));
}

/** Serves the changing methods of the same resource. */
export async function action({
  params,
  request,
}: Route.ActionArgs): Promise<Response> {
  return runMcpMilestoneRoute(request, handlers(params));
}
