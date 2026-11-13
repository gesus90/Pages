import { runManagementRoute } from "@/app/lib/management-route.server";
import { mcpDeviceMethodNotAllowed } from "@/app/lib/mcp-device-response.server";

import type { Route } from "./+types/api-mcp-v1-users";

/** Serves the shared PAGE-316 business administration contract. */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  if (request.method === "GET")
    return runManagementRoute(request, "users_list");
  if (request.method === "POST")
    return runManagementRoute(request, "users_create");
  return mcpDeviceMethodNotAllowed("GET, POST");
}

/** Serves the shared PAGE-316 business administration contract. */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  if (request.method === "GET")
    return runManagementRoute(request, "users_list");
  if (request.method === "POST")
    return runManagementRoute(request, "users_create");
  return mcpDeviceMethodNotAllowed("GET, POST");
}
