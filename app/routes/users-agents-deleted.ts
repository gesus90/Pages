import {
  authenticatedUserContext,
  requireUserManagement,
} from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { AgentDeletionError } from "@/backend/service/employee/AgentDeletionService";

import type { MiddlewareFunction } from "react-router";
import type { Route } from "./+types/users-agents-deleted";

/** Requires user management before listing restorable agents. */
export const middleware: MiddlewareFunction[] = [requireUserManagement];

/** Lists recently deleted agents for administrators. */
export async function loader({
  context,
  request,
}: Route.LoaderArgs): Promise<Response> {
  const actor = context.get(authenticatedUserContext);
  if (!actor) throw new Response("Forbidden", { status: 403 });
  try {
    const services = await getApplicationServices();
    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor");
    const page = await services.agentDeletionService.deleted(
      actor.id,
      cursor,
      100,
    );
    return Response.json(page, { headers: { "Cache-Control": "no-store" } });
  } catch (error: unknown) {
    if (!(error instanceof AgentDeletionError)) throw error;
    return Response.json(
      { error: error.code, reason: error.reason },
      { status: 403 },
    );
  }
}
