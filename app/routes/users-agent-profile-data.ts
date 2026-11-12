import {
  authenticatedUserContext,
  requireAuthenticatedUser,
} from "@/app/lib/auth.server";
import { agentProfileResponse } from "@/app/lib/agent-profile-response.server";
import { getApplicationServices } from "@/app/lib/services.server";

import type { MiddlewareFunction } from "react-router";
import type { Route } from "./+types/users-agent-profile-data";

/** Requires a signed-in person; what it reads is decided by the profile rights. */
export const middleware: MiddlewareFunction[] = [requireAuthenticatedUser];

/**
 * Answers the read-only profile of one agent (PAGE-308): role, documents,
 * model and workload, never memory, chat contents or credentials.
 *
 * @remarks
 * Administrators, the leaders of a group of the agent and the managers of a
 * project of the agent get it.
 */
export async function loader({
  context,
  params,
}: Route.LoaderArgs): Promise<Response> {
  const actor = context.get(authenticatedUserContext);
  if (!actor) throw new Response("Forbidden", { status: 403 });
  const services = await getApplicationServices();
  return agentProfileResponse(() =>
    services.agentProfileReadService.read(actor.id, params.agentId),
  );
}
