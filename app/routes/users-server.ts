import {
  authenticatedUserContext,
  requireUserManagement,
} from "@/app/lib/auth.server";
import { readLocalStateAudience } from "@/app/lib/local-state/local-state-audience.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { handleUsersAction } from "@/app/lib/user-actions/user-actions.server";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";

import type { MiddlewareFunction } from "react-router";
import type { ApplicationServices } from "@/app/lib/services.server";
import type { UsersActionResult } from "@/app/lib/user-actions/user-action-support.server";
import type { UsersPageData } from "./users";
import type { Route } from "./+types/users-server";

/** The agents tab of the account, or `null` when it may not see agents (PAGE-266). */
async function readAgentPage(
  services: ApplicationServices,
  actorId: string,
): Promise<UsersPageData["agents"]> {
  if (!services.agentEmployeeAdministration) return null;
  try {
    return await services.agentEmployeeAdministration.page(actorId);
  } catch (error: unknown) {
    if (error instanceof AgentEmployeeError) return null;
    throw error;
  }
}

/** Checks management access independently of navigation visibility; the page's endpoint repeats it. */
export const middleware: MiddlewareFunction[] = [requireUserManagement];

/** Loads one server-filtered management view. */
export async function loader({
  context,
}: Route.LoaderArgs): Promise<UsersPageData> {
  const actor = context.get(authenticatedUserContext);
  if (!actor)
    throw new Error("Authenticated middleware did not provide a user.");
  const services = await getApplicationServices();
  const [directory, privateWikiPages, audience, agents] = await Promise.all([
    services.administrationService.pageData(actor.id),
    services.wikiService.listAllPlaceholders(actor),
    readLocalStateAudience(services, actor),
    readAgentPage(services, actor.id),
  ]);
  return { ...directory, privateWikiPages, audience, agents };
}

/** Applies validated mutations through the transactional A2 service boundary. */
export async function action({
  request,
  context,
}: Route.ActionArgs): Promise<UsersActionResult> {
  if (request.method !== "POST")
    throw new Response("Method Not Allowed", {
      headers: { Allow: "POST" },
      status: 405,
    });
  const actor = context.get(authenticatedUserContext);
  if (!actor) throw new Response("Forbidden", { status: 403 });
  const formData = await request.formData();
  return handleUsersAction(formData.get("intent"), {
    actor,
    formData,
    services: await getApplicationServices(),
  });
}
