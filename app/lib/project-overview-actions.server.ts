import { randomUUID } from "node:crypto";

import { data } from "react-router";

import {
  ProjectManagementDeniedError,
  ProjectAccessDeniedError,
  ProjectDepartmentError,
  ProjectNotFoundError,
} from "@/backend/error/ProjectErrors";
import { isProjectStatus } from "@/definition/Project";

import type { ApplicationServices } from "@/app/lib/services.server";
import type { ProjectStatus } from "@/definition/Project";
import type { ProjectDepartmentErrorCode } from "@/backend/error/ProjectErrors";
import type { User } from "@/definition/User";

const MAXIMUM_DESCRIPTION_LENGTH = 10_000;
const MAXIMUM_NAME_LENGTH = 200;
const PLACEHOLDER_COLORS = [
  "#FCE3D3",
  "#DFEAFE",
  "#DCF2E5",
  "#EEE4F8",
  "#E9EDF2",
] as const;

/** Why creating a project failed. */
export type ProjectActionError =
  "forbidden" | "invalidInput" | "projectNotFound" | ProjectDepartmentErrorCode;

/** What the client receives after a project overview action. */
export type ProjectActionResult =
  | {
      readonly ok: true;
      readonly intent: "create-project";
      readonly projectId: string;
      readonly canOpen?: boolean;
    }
  | {
      readonly ok: false;
      readonly intent: "create-project";
      readonly error: ProjectActionError;
    };

/** The response the project overview action returns to React Router. */
export type ProjectActionResponse = ReturnType<
  typeof data<ProjectActionResult>
>;

/** Everything a project overview action handler needs from the request. */
export interface ProjectOverviewActionContext {
  readonly actor: User;
  readonly formData: FormData;
  readonly services: ApplicationServices;
}

interface ProjectInput {
  readonly templateId: string | null;
  readonly name: string;
  readonly description: string;
  readonly status: ProjectStatus;
  readonly departmentIds: readonly string[];
}

function getPlaceholderColor(projectId: string): string {
  const characterSum = Array.from(projectId).reduce(
    (total, character) => total + character.charCodeAt(0),
    0,
  );

  return PLACEHOLDER_COLORS[characterSum % PLACEHOLDER_COLORS.length];
}

function getProjectInput(formData: FormData): ProjectInput | null {
  const name = formData.get("name");
  const description = formData.get("description");
  const status = formData.get("status");
  const departmentIds = formData.getAll("departmentIds");
  const templateId = formData.get("templateId");

  if (
    typeof name !== "string" ||
    typeof description !== "string" ||
    !isProjectStatus(status) ||
    (templateId !== null && typeof templateId !== "string") ||
    !departmentIds.every((id): id is string => typeof id === "string")
  ) {
    return null;
  }

  const trimmedName = name.trim();
  const trimmedDescription = description.trim();

  if (
    !trimmedName ||
    trimmedName.length > MAXIMUM_NAME_LENGTH ||
    trimmedDescription.length > MAXIMUM_DESCRIPTION_LENGTH
  ) {
    return null;
  }

  return {
    templateId,
    description: trimmedDescription,
    name: trimmedName,
    status,
    departmentIds,
  };
}

function failed(
  error: ProjectActionError,
  status: number,
): ProjectActionResponse {
  return data<ProjectActionResult>(
    { error, intent: "create-project", ok: false },
    { status },
  );
}

function getProjectActionError(error: unknown): ProjectActionResponse {
  if (error instanceof ProjectDepartmentError) {
    return failed(
      error.code,
      error.code === "departmentOutOfScope" ? 403 : 400,
    );
  }
  if (
    error instanceof ProjectManagementDeniedError ||
    error instanceof ProjectAccessDeniedError
  ) {
    return failed("forbidden", 403);
  }

  if (error instanceof ProjectNotFoundError) {
    return failed("projectNotFound", 404);
  }

  throw error;
}

async function createProject({
  actor,
  formData,
  services,
}: ProjectOverviewActionContext): Promise<ProjectActionResponse> {
  const input = getProjectInput(formData);

  if (!input) {
    return failed("invalidInput", 400);
  }

  const id = randomUUID();
  let canOpen: boolean;

  try {
    const project = {
      description: input.description,
      departmentIds: input.departmentIds,
      id,
      name: input.name,
      ownerId: actor.id,
      placeholderColor: getPlaceholderColor(id),
      status: input.status,
    };
    canOpen = input.templateId
      ? await services.projectService.createFromTemplate(
          actor,
          input.templateId,
          project,
        )
      : await services.projectService.create(actor, project);
  } catch (error: unknown) {
    return getProjectActionError(error);
  }

  return data<ProjectActionResult>({
    intent: "create-project",
    ok: true,
    projectId: id,
    ...(canOpen === false ? { canOpen } : {}),
  });
}

/**
 * Runs the project overview action that belongs to a submitted intent.
 *
 * @param intent - The `intent` field of the submitted form.
 * @param context - The actor, the form and the services of the request.
 * @returns The outcome for the client; an unknown intent counts as invalid input.
 */
export async function handleProjectOverviewAction(
  intent: FormDataEntryValue | null,
  context: ProjectOverviewActionContext,
): Promise<ProjectActionResponse> {
  if (intent === "create-project") {
    return createProject(context);
  }

  return failed("invalidInput", 400);
}
