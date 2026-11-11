import { runMcpStorageRoute } from "@/app/lib/mcp-storage-route.server";

import type { Route } from "./+types/api-mcp-v1-storage";

/** Serves Storage reads and unknown paths with bearer-authenticated JSON (PAGE-299). */
export async function loader({
  request,
  params,
}: Route.LoaderArgs): Promise<Response> {
  return runMcpStorageRoute(request, params["*"] ?? "");
}

/** Serves Storage changes through the same policy and contract translation. */
export async function action({
  request,
  params,
}: Route.ActionArgs): Promise<Response> {
  return runMcpStorageRoute(request, params["*"] ?? "");
}
