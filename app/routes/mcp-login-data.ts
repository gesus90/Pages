import { routeDataResponse } from "@/app/lib/local-state/route-data.server";

import { loader as mcpLoginLoader } from "./mcp-login-server";

/** Answers the MCP consent view, or its redirect (PAGE-235). */
export async function loader(
  args: Parameters<typeof mcpLoginLoader>[0],
): Promise<Response> {
  return routeDataResponse(await mcpLoginLoader(args));
}
