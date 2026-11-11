import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { AutomationError } from "@/backend/error/AutomationError";

import type { Route } from "./+types/automations-run-data";

/**
 * Reads one run of a visible automation with its bounded answer and output
 * (`/automationen-api/runs/{automationId}/{runId}`), PAGE-297.
 */
export async function loader({
  context,
  params,
}: Route.LoaderArgs): Promise<Response> {
  const user = context.get(authenticatedUserContext);
  if (!user) throw new Response("Forbidden", { status: 403 });
  const services = await getApplicationServices();
  try {
    return Response.json(
      await services.automationService.run(user.id, {
        automationId: params.automationId,
        runId: params.runId,
      }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: unknown) {
    if (error instanceof AutomationError)
      return Response.json({ error: error.code }, { status: error.status });
    throw error;
  }
}
