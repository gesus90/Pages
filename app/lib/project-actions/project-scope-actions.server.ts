import { redirect } from "react-router";

import { ProjectAccessDeniedError } from "@/backend/error/ProjectErrors";
import { invalidInput } from "./project-action-support.server";

import type { ProjectActionResponse } from "./project-action-support.server";
import type { ApplicationServices } from "@/app/lib/services.server";
import type { User } from "@/definition/User";

/** Request inputs and the single service needed for assignment and retention actions. */
export interface ProjectScopeActionContext {
  readonly actor: User;
  readonly projectId: string;
  readonly formData: FormData;
  readonly services: Pick<ApplicationServices, "projectService">;
}

/** Applies project-wide scope or retention actions and redirects only after successful persistence. */
export async function handleProjectScopeAction(
  intent: FormDataEntryValue | null,
  context: ProjectScopeActionContext,
): Promise<Response | ProjectActionResponse | undefined> {
  const { actor, formData, projectId, services } = context;
  if (intent === "archive-project") {
    await services.projectService.archive(actor, projectId);
    return redirect("/projekte?archiv=1");
  }
  if (intent === "delete-project") {
    await services.projectService.deletePermanently(actor, projectId);
    return redirect("/projekte");
  }
  if (intent !== "set-departments") return undefined;
  const departmentIds = formData.getAll("departmentIds");
  if (!departmentIds.every((id): id is string => typeof id === "string"))
    return invalidInput();
  await services.projectService.setDepartments(actor, projectId, departmentIds);
  try {
    await services.projectService.getById(actor, projectId);
    return redirect(`/projekte/${encodeURIComponent(projectId)}`);
  } catch (error: unknown) {
    if (error instanceof ProjectAccessDeniedError) return redirect("/projekte");
    throw error;
  }
}
