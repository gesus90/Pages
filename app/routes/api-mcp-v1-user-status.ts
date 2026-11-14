import { runManagementRoute } from "@/app/lib/management-route.server";
import { mcpDeviceMethodNotAllowed } from "@/app/lib/mcp-device-response.server";

import type { Route } from "./+types/api-mcp-v1-user-status";

/** Serves the shared PAGE-316 business administration contract. */
export async function loader({
  request,
  params,
}: Route.LoaderArgs): Promise<Response> {
  if (request.method === "POST")
    return runManagementRoute(request, "users_set_status", {
      userId: params.userId,
    });
  return mcpDeviceMethodNotAllowed("POST");
}

/** Serves the shared PAGE-316 business administration contract. */
export async function action({
  request,
  params,
}: Route.ActionArgs): Promise<Response> {
  if (request.method === "POST")
    return runManagementRoute(request, "users_set_status", {
      userId: params.userId,
    });
  return mcpDeviceMethodNotAllowed("POST");
}
