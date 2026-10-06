import { useLoaderData } from "react-router";
import { ManagementWorkspace } from "@/app/components/users/management-workspace";
import {
  authenticatedUserContext,
  requireUserManagement,
} from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { handleUsersAction } from "@/app/lib/user-actions/user-actions.server";

import type { MiddlewareFunction } from "react-router";
import type { AdministrationPageData } from "@/definition/Authorization";
import type { UsersActionResult } from "@/app/lib/user-actions/user-action-support.server";
import type { Route } from "./+types/users";

/** Checks management access independently of navigation visibility. */
export const middleware: MiddlewareFunction[] = [requireUserManagement];

/** Loads one server-filtered management view. */
export async function loader({
  context,
}: Route.LoaderArgs): Promise<AdministrationPageData> {
  const actor = context.get(authenticatedUserContext);
  if (!actor)
    throw new Error("Authenticated middleware did not provide a user.");
  const services = await getApplicationServices();
  return services.administrationService.pageData(actor.id);
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

/** Renders users, roles and departments in their permitted sections. */
export default function UsersRoute(): React.ReactElement {
  return <ManagementWorkspace directory={useLoaderData<typeof loader>()} />;
}
