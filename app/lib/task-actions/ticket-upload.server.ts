import {
  WorkItemAccessDeniedError,
  WorkItemNotFoundError,
  WorkItemValidationError,
} from "@/backend/error/WorkItemErrors";
import { ProjectAccessDeniedError } from "@/backend/error/ProjectErrors";

/**
 * Maps the failure of a ticket upload to a status code.
 *
 * @param error - The failure.
 * @returns The status and the code the client translates as
 * `tasks.error.<code>`, or `null` for failures that are not the person's doing.
 */
export function describeTicketUploadFailure(
  error: unknown,
): { readonly status: number; readonly error: string } | null {
  if (error instanceof WorkItemValidationError) {
    return {
      error: error.code,
      status: error.code === "attachmentTooLarge" ? 413 : 400,
    };
  }

  if (
    error instanceof WorkItemNotFoundError ||
    error instanceof ProjectAccessDeniedError
  ) {
    return { error: "notFound", status: 404 };
  }

  return error instanceof WorkItemAccessDeniedError
    ? { error: "forbidden", status: 403 }
    : null;
}
