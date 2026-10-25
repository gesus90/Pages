import { AgentOperationError } from "@/backend/error/AgentOperationError";
import {
  ProjectAccessDeniedError,
  ProjectNotFoundError,
} from "@/backend/error/ProjectErrors";
import {
  WorkItemAccessDeniedError,
  WorkItemConflictError,
  WorkItemHierarchyError,
  WorkItemNotFoundError,
  WorkItemValidationError,
} from "@/backend/error/WorkItemErrors";

import type { WorkItemErrorCode } from "@/backend/error/WorkItemErrors";

/** References that do not resolve; a hidden record is reported like a missing one. */
const NOT_FOUND_CODES: ReadonlySet<WorkItemErrorCode> = new Set([
  "statusNotFound",
  "targetStatusNotFound",
  "milestoneNotFound",
  "milestoneOtherProject",
  "dependencyNotFound",
]);

/** States the request cannot be applied to, as opposed to a malformed request. */
const CONFLICT_CODES: ReadonlySet<WorkItemErrorCode> = new Set([
  "descriptionConflict",
  "dependencyExists",
  "milestoneInitiativeInUse",
  "ticketArchived",
]);

/**
 * Turns the business failures of tickets, milestones and projects into the
 * fixed codes of the agent API.
 *
 * @param error - Whatever the ticket services threw.
 * @returns The agent error for a business failure, or the error unchanged.
 *
 * @remarks
 * A parent, milestone or status the account cannot see is reported like one
 * that does not exist, so no response tells anything about a hidden record.
 */
export function translateAgentTicketError(error: unknown): unknown {
  if (
    error instanceof WorkItemNotFoundError ||
    error instanceof ProjectNotFoundError ||
    error instanceof ProjectAccessDeniedError
  )
    return new AgentOperationError("NOT_FOUND");
  if (error instanceof WorkItemAccessDeniedError)
    return new AgentOperationError("FORBIDDEN");
  if (error instanceof WorkItemConflictError)
    return new AgentOperationError("CONFLICT");
  if (error instanceof WorkItemHierarchyError)
    return new AgentOperationError(
      error.code.endsWith("Missing") ? "NOT_FOUND" : "INVALID_REQUEST",
    );
  if (error instanceof WorkItemValidationError) {
    const attachmentReasons = {
      attachmentUploadRequired: "ticket_attachment_upload_required",
      attachmentUploadUnavailable: "ticket_attachment_upload_unavailable",
      attachmentUnavailable: "ticket_attachment_unavailable",
    } as const;
    if (error.code in attachmentReasons) {
      const reason =
        attachmentReasons[error.code as keyof typeof attachmentReasons];
      return new AgentOperationError("INVALID_REQUEST", { reason });
    }
    if (NOT_FOUND_CODES.has(error.code))
      return new AgentOperationError("NOT_FOUND");
    if (CONFLICT_CODES.has(error.code))
      return new AgentOperationError("CONFLICT");
    return new AgentOperationError("INVALID_REQUEST");
  }
  return error;
}
