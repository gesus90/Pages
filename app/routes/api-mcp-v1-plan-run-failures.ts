import {
  mcpPlanReadHandlers,
  runMcpPlanRoute,
} from "@/app/lib/mcp-plan-route.server";

import type { Route } from "./+types/api-mcp-v1-plan-run-failures";

/**
 * `GET /api/mcp/v1/plan-runs/failures`, the tool `summarize_run_failures` (PAGE-307).
 *
 * @remarks
 * Only the device token of a paired machine admits a request. The answer is
 * the `result` of the operation `plans.runs.failures`, with the rights of the account.
 */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  return runMcpPlanRoute(
    request,
    mcpPlanReadHandlers("plans.runs.failures", () => ({})),
  );
}
