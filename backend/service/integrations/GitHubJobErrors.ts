import {
  WORK_ITEM_ERROR_MESSAGES,
  WorkItemValidationError,
  WorkItemAccessDeniedError,
  WorkItemNotFoundError,
} from "@/backend/error/WorkItemErrors";
import {
  ProjectAccessDeniedError,
  ProjectManagementDeniedError,
  ProjectNotFoundError,
} from "@/backend/error/ProjectErrors";

import type { WorkItemErrorCode } from "@/backend/error/WorkItemErrors";

const ERROR_CLASSES = {
  project_access: ProjectAccessDeniedError,
  project_management: ProjectManagementDeniedError,
  project_missing: ProjectNotFoundError,
  task_access: WorkItemAccessDeniedError,
  task_missing: WorkItemNotFoundError,
};

function isWorkItemErrorCode(code: string): code is WorkItemErrorCode {
  return Object.hasOwn(WORK_ITEM_ERROR_MESSAGES, code);
}

/** Transfers only known domain codes, never provider messages, bodies or secrets. */
export function gitHubJobErrorCode(error: unknown): string | null {
  if (error instanceof WorkItemValidationError) return error.code;
  for (const [code, ErrorClass] of Object.entries(ERROR_CLASSES)) {
    if (error instanceof ErrorClass) return code;
  }
  return null;
}

/** Restores the domain errors existing routes already translate. */
export function restoreGitHubJobError(code: string): Error {
  if (isWorkItemErrorCode(code)) return new WorkItemValidationError(code);
  for (const [known, ErrorClass] of Object.entries(ERROR_CLASSES)) {
    if (known === code) return new ErrorClass();
  }
  if (code === "integration_outcome_uncertain")
    return new Error(
      "GitHub job outcome needs operator reconciliation; it was not repeated.",
    );
  return new Error(
    "GitHub job failed; inspect the integration service status.",
  );
}
