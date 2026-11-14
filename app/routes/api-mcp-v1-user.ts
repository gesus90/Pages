import {
  rejectManagementAccountDeletion,
  runManagementRoute,
} from "@/app/lib/management-route.server";
import { mcpDeviceMethodNotAllowed } from "@/app/lib/mcp-device-response.server";

import type { Route } from "./+types/api-mcp-v1-user";

/** Serves the shared PAGE-316 business administration contract. */
export async function loader({
  request,
  params,
}: Route.LoaderArgs): Promise<Response> {
  if (request.method === "GET")
    return runManagementRoute(request, "users_read", { userId: params.userId });
  if (request.method === "PATCH")
    return runManagementRoute(request, "users_update", {
      userId: params.userId,
    });
  if (request.method === "DELETE")
    return rejectManagementAccountDeletion(request);
  return mcpDeviceMethodNotAllowed("GET, PATCH");
}

/** Serves the shared PAGE-316 business administration contract. */
export async function action({
  request,
  params,
}: Route.ActionArgs): Promise<Response> {
  if (request.method === "GET")
    return runManagementRoute(request, "users_read", { userId: params.userId });
  if (request.method === "PATCH")
    return runManagementRoute(request, "users_update", {
      userId: params.userId,
    });
  if (request.method === "DELETE")
    return rejectManagementAccountDeletion(request);
  return mcpDeviceMethodNotAllowed("GET, PATCH");
}
