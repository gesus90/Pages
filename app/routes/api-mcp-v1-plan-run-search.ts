import {
  mcpPlanReadHandlers,
  runMcpPlanRoute,
} from "@/app/lib/mcp-plan-route.server";

import type { Route } from "./+types/api-mcp-v1-plan-run-search";

/**
 * `GET /api/mcp/v1/plan-runs`, the tool `list_runs` (PAGE-307).
 *
 * @remarks
 * Only the device token of a paired machine admits a request. The answer is
 * the `result` of the operation `plans.runs.search`, with the rights of the account.
 */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  return runMcpPlanRoute(
    request,
    mcpPlanReadHandlers("plans.runs.search", () => ({})),
  );
}
