import { runManagementRoute } from "@/app/lib/management-route.server";
import { mcpDeviceMethodNotAllowed } from "@/app/lib/mcp-device-response.server";

import type { Route } from "./+types/api-mcp-v1-management-project-members";

/** Serves the shared PAGE-316 business administration contract. */
export async function loader({
  request,
  params,
}: Route.LoaderArgs): Promise<Response> {
  if (request.method === "PUT")
    return runManagementRoute(request, "project_members_set", {
      projectId: params.projectId,
    });
  return mcpDeviceMethodNotAllowed("PUT");
}

/** Serves the shared PAGE-316 business administration contract. */
export async function action({
  request,
  params,
}: Route.ActionArgs): Promise<Response> {
  if (request.method === "PUT")
    return runManagementRoute(request, "project_members_set", {
      projectId: params.projectId,
    });
  return mcpDeviceMethodNotAllowed("PUT");
}
