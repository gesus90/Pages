import {
  authenticatedUserContext,
  requireAuthenticatedUser,
} from "@/app/lib/auth.server";
import { agentProfileResponse } from "@/app/lib/agent-profile-response.server";
import { getApplicationServices } from "@/app/lib/services.server";

import type { MiddlewareFunction } from "react-router";
import type { Route } from "./+types/users-group-agents-data";

/** Requires a signed-in person; what it reads is decided by the profile rights. */
export const middleware: MiddlewareFunction[] = [requireAuthenticatedUser];

/**
 * Answers the agents of a group for its overview in the user management (PAGE-308).
 *
 * @remarks
 * Only an administrator and the leaders of the group get it; every other
 * request is refused by the same rights the Pages interface of the MCP uses.
 */
export async function loader({
  context,
  params,
}: Route.LoaderArgs): Promise<Response> {
  const actor = context.get(authenticatedUserContext);
  if (!actor) throw new Response("Forbidden", { status: 403 });
  const services = await getApplicationServices();
  return agentProfileResponse(() =>
    services.agentProfileReadService.groupAgents(actor.id, params.groupId),
  );
}
