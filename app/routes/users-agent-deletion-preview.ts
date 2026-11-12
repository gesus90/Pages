import {
  authenticatedUserContext,
  requireUserManagement,
} from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { AgentDeletionError } from "@/backend/service/employee/AgentDeletionService";

import type { MiddlewareFunction } from "react-router";
import type { Route } from "./+types/users-agent-deletion-preview";

/** Requires user management before reading a deletion preview. */
export const middleware: MiddlewareFunction[] = [requireUserManagement];

/** Shows the agent's artifacts, retained contributions and active-run blockers. */
export async function loader({
  context,
  params,
}: Route.LoaderArgs): Promise<Response> {
  const actor = context.get(authenticatedUserContext);
  if (!actor) throw new Response("Forbidden", { status: 403 });
  try {
    const services = await getApplicationServices();
    const preview = await services.agentDeletionService.preview(
      actor.id,
      params.agentId,
    );
    return Response.json(preview, { headers: { "Cache-Control": "no-store" } });
  } catch (error: unknown) {
    if (!(error instanceof AgentDeletionError)) throw error;
    const status = {
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      CONFLICT: 409,
      INVALID_REQUEST: 400,
    }[error.code];
    return Response.json(
      { error: error.code, reason: error.reason },
      { status },
    );
  }
}
