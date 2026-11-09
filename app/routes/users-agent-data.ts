import {
  authenticatedUserContext,
  requireUserManagement,
} from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";

import type { MiddlewareFunction } from "react-router";
import type { Route } from "./+types/users-agent-data";

/** Checks management access before the loader runs, as the management route does. */
export const middleware: MiddlewareFunction[] = [requireUserManagement];

/**
 * Answers the panel of one agent (PAGE-266): its configuration, documents,
 * memory with archive and versions, and its activity.
 *
 * @remarks
 * Only an account that may see the agent's account gets it; every other
 * request is answered as if the agent did not exist.
 */
export async function loader({
  context,
  params,
}: Route.LoaderArgs): Promise<Response> {
  const actor = context.get(authenticatedUserContext);
  if (!actor) throw new Response("Forbidden", { status: 403 });
  const services = await getApplicationServices();
  try {
    const detail = await services.agentEmployeeAdministration.detail(
      actor.id,
      params.agentId,
    );
    return Response.json(detail, { headers: { "Cache-Control": "no-store" } });
  } catch (error: unknown) {
    if (error instanceof AgentEmployeeError)
      return Response.json(
        { error: error.code },
        { status: error.code === "forbidden" ? 403 : 404 },
      );
    throw error;
  }
}
