import { authenticatedUserContext } from "@/app/lib/auth.server";
import { readLocalStateAudience } from "@/app/lib/local-state/local-state-audience.server";
import { handleProjectOverviewAction } from "@/app/lib/project-overview-actions.server";
import { getApplicationServices } from "@/app/lib/services.server";

import type { ProjectActionResponse } from "@/app/lib/project-overview-actions.server";
import type { ProjectsLoaderData } from "./projects";
import type { Route } from "./+types/projects-server";

/** Loads the overview; the endpoint `/projekte-api/list` answers with it. */
export async function loader({
  context,
}: Route.LoaderArgs): Promise<ProjectsLoaderData> {
  const actor = context.get(authenticatedUserContext);

  if (!actor) {
    throw new Error("Authenticated middleware did not provide a user.");
  }

  const services = await getApplicationServices();
  const projects = await services.projectService.findAll(actor);

  return {
    templates: await services.projectService.findTemplates(actor),
    archivedProjects: await services.projectService.findArchived(actor),
    canDeleteProjects: await services.projectService.canDeleteProjects(actor),
    canManageProjects: await services.projectService.canCreateProjects(actor),
    projects,
    departmentChoices: await services.projectService.departmentChoices(actor),
    audience: await readLocalStateAudience(services, actor),
  };
}

/** Creates projects through the persistent service layer. */
export async function action({
  context,
  request,
}: Route.ActionArgs): Promise<ProjectActionResponse> {
  if (request.method !== "POST") {
    throw new Response("Method Not Allowed", {
      headers: { Allow: "POST" },
      status: 405,
    });
  }

  const actor = context.get(authenticatedUserContext);

  if (!actor) {
    throw new Response("Forbidden", { status: 403 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent");
  const services = await getApplicationServices();

  return handleProjectOverviewAction(intent, { actor, formData, services });
}
