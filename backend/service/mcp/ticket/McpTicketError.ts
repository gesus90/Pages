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

/** Error codes of the ticket API, as the interface names them. */
export type McpTicketErrorCode =
  | "invalid_token"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "too_large"
  | "invalid_request";

const STATUS_OF_CODE: Readonly<Record<McpTicketErrorCode, number>> = {
  conflict: 409,
  forbidden: 403,
  invalid_request: 400,
  invalid_token: 401,
  not_found: 404,
  too_large: 413,
};

/** Service codes that name a value which does not exist or is hidden from the account. */
const NOT_FOUND_CODES: ReadonlySet<WorkItemErrorCode> = new Set([
  "attachmentUnavailable",
  "checklistItemNotFound",
  "departmentNotFound",
  "epicMissing",
  "groupNotFound",
  "initiativeMissing",
  "labelNotFound",
  "linkTargetNotFound",
  "milestoneNotFound",
  "parentTaskMissing",
  "statusNotFound",
  "targetStatusNotFound",
]);

/** Service codes of a value that changed since the client read it. */
const CONFLICT_CODES: ReadonlySet<WorkItemErrorCode> = new Set([
  "descriptionConflict",
  "ticketConflict",
]);

/** Fixed public failure of the ticket API; it carries a code and never a diagnosis. */
export class McpTicketError extends Error {
  public readonly code: McpTicketErrorCode;
  public readonly status: number;

  /**
   * Creates the error.
   *
   * @param code - The error code of the interface; it decides the HTTP status.
   */
  public constructor(code: McpTicketErrorCode) {
    super("The ticket request was rejected.");
    this.name = "McpTicketError";
    this.code = code;
    this.status = STATUS_OF_CODE[code];
  }
}

/** Maps the code of a rejected ticket payload to the code of the interface. */
function codeOfWorkItemError(code: WorkItemErrorCode): McpTicketErrorCode {
  if (NOT_FOUND_CODES.has(code)) return "not_found";
  if (CONFLICT_CODES.has(code)) return "conflict";
  if (code === "attachmentTooLarge") return "too_large";
  return "invalid_request";
}

/**
 * Translates a failure of the ticket services into the error of the interface.
 *
 * @param error - Whatever a service threw.
 * @returns The interface error, or `null` for a failure that is not the
 * client's doing and stays an internal error.
 *
 * @remarks
 * A missing right is `forbidden`; a ticket or project the account cannot see
 * is `not_found`, exactly like one that does not exist.
 */
export function toMcpTicketError(error: unknown): McpTicketError | null {
  if (error instanceof McpTicketError) return error;
  if (error instanceof WorkItemAccessDeniedError)
    return new McpTicketError("forbidden");
  if (
    error instanceof WorkItemNotFoundError ||
    error instanceof ProjectNotFoundError ||
    error instanceof ProjectAccessDeniedError
  )
    return new McpTicketError("not_found");
  if (error instanceof WorkItemConflictError)
    return new McpTicketError("conflict");
  if (
    error instanceof WorkItemValidationError ||
    error instanceof WorkItemHierarchyError
  )
    return new McpTicketError(codeOfWorkItemError(error.code));
  return null;
}
