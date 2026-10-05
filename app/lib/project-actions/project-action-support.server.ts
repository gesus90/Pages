import { data } from "react-router";
import {
  ProjectAccessDeniedError,
  ProjectManagementDeniedError,
  ProjectNotFoundError,
} from "@/backend/error/ProjectErrors";
import {
  WorkItemAccessDeniedError,
  WorkItemValidationError,
} from "@/backend/error/WorkItemErrors";

import type { ApplicationServices } from "@/app/lib/services.server";
import type { ProjectService } from "@/backend/service/ProjectService";
import type { User } from "@/definition/User";

/** What the client receives after a project detail action. */
export type ProjectDetailActionResult =
  { readonly ok: true } | { readonly ok: false; readonly error: string };

/** The response an action handler returns to React Router. */
export type ProjectActionResponse = ReturnType<
  typeof data<ProjectDetailActionResult>
>;

/** Everything a project action handler needs from the request. */
export interface ProjectActionContext {
  readonly actor: User;
  readonly formData: FormData;
  readonly projectId: string;
  readonly services: ApplicationServices;
}

/** Handles one project detail action. */
export type ProjectActionHandler = (
  context: ProjectActionContext,
) => Promise<ProjectActionResponse>;

/** The values of a project detail update. */
export type ProjectDetailsChange = Parameters<
  ProjectService["updateDetails"]
>[2];

/** Answers an action that changed something. */
export function succeeded(): ProjectActionResponse {
  return data<ProjectDetailActionResult>({ ok: true });
}

/** Answers an action whose form fields are missing or malformed. */
export function invalidInput(): ProjectActionResponse {
  return data<ProjectDetailActionResult>(
    { error: "invalidInput", ok: false },
    { status: 400 },
  );
}

/**
 * Maps the failures of a project detail action to client responses.
 *
 * @param error - The failure thrown by a service.
 * @returns The response describing the failure.
 * @throws The original value when it is no `Error`.
 */
export function toActionError(error: unknown): ProjectActionResponse {
  if (
    error instanceof ProjectManagementDeniedError ||
    error instanceof ProjectAccessDeniedError ||
    error instanceof WorkItemAccessDeniedError
  ) {
    return data<ProjectDetailActionResult>(
      { error: "forbidden", ok: false },
      { status: 403 },
    );
  }

  if (
    error instanceof ProjectNotFoundError ||
    error instanceof WorkItemValidationError
  ) {
    const status = error instanceof ProjectNotFoundError ? 404 : 400;

    return data<ProjectDetailActionResult>(
      { error: "invalidInput", ok: false },
      { status },
    );
  }

  if (error instanceof Error) {
    return invalidInput();
  }

  throw error;
}

/**
 * Saves the project details with some values replaced.
 *
 * @param context - The request context of the action.
 * @param changes - The values that differ from the stored ones.
 *
 * @remarks
 * The service replaces all details at once, so the stored values are read
 * first and kept for everything the action does not change.
 */
export async function updateProjectDetails(
  { actor, projectId, services }: ProjectActionContext,
  changes: Partial<ProjectDetailsChange>,
): Promise<void> {
  const current = await services.projectService.getById(actor, projectId);

  await services.projectService.updateDetails(actor, projectId, {
    description: current.description,
    managerId: current.managerId,
    name: current.name,
    notes: current.notes,
    progress: current.progress,
    startDate: current.startDate,
    status: current.status,
    targetDate: current.targetDate,
    ...changes,
  });
}
