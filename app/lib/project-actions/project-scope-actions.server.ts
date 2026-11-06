import { redirect } from "react-router";

import { ProjectAccessDeniedError } from "@/backend/error/ProjectErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import { invalidInput } from "./project-action-support.server";

import type { ProjectActionResponse } from "./project-action-support.server";
import type { ApplicationServices } from "@/app/lib/services.server";
import type { User } from "@/definition/User";

/** Request inputs and the services needed for assignment and retention actions. */
export interface ProjectScopeActionContext {
  readonly actor: User;
  readonly projectId: string;
  readonly formData: FormData;
  readonly services: Pick<
    ApplicationServices,
    "projectService" | "pagesEventPublisher"
  >;
}

/**
 * Applies project-wide scope or retention actions and redirects only after successful persistence.
 *
 * @remarks
 * Each of them may take the project out of somebody's sight, so each
 * announces `project.access.changed` after it was stored; open pages then
 * read again and a revoked account's pages learn of the refusal. The project
 * services store the same event in the outbox with the change itself.
 */
export async function handleProjectScopeAction(
  intent: FormDataEntryValue | null,
  context: ProjectScopeActionContext,
): Promise<Response | ProjectActionResponse | undefined> {
  const { actor, formData, projectId, services } = context;
  const announce = (): void =>
    services.pagesEventPublisher.publish({
      type: "project.access.changed",
      id: projectId,
    });
  if (intent === "archive-project") {
    await services.projectService.archive(actor, projectId);
    announce();
    return redirect("/projekte?archiv=1");
  }
  if (intent === "delete-project") {
    await services.projectService.deletePermanently(actor, projectId);
    announce();
    return redirect("/projekte");
  }
  if (intent !== "set-departments") return undefined;
  const departmentIds = formData.getAll("departmentIds");
  if (!departmentIds.every((id): id is string => typeof id === "string"))
    return invalidInput();
  await services.projectService.setDepartments(actor, projectId, departmentIds);
  announce();
  try {
    await services.projectService.getById(actor, projectId);
    return redirect(`/projekte/${encodeURIComponent(projectId)}`);
  } catch (error: unknown) {
    logCaughtError("project_scope_actions", error);

    if (error instanceof ProjectAccessDeniedError) return redirect("/projekte");
    throw error;
  }
}
