import {
  ProjectAccessDeniedError,
  ProjectDepartmentError,
  ProjectManagementDeniedError,
  ProjectNotFoundError,
} from "@/backend/error/ProjectErrors";
import {
  WorkItemAccessDeniedError,
  WorkItemValidationError,
} from "@/backend/error/WorkItemErrors";

/** Error codes of the project API, as the interface names them. */
export type McpProjectErrorCode =
  "invalid_token" | "forbidden" | "not_found" | "invalid_request";

const STATUS_OF_CODE: Readonly<Record<McpProjectErrorCode, number>> = {
  forbidden: 403,
  invalid_request: 400,
  invalid_token: 401,
  not_found: 404,
};

/** Fixed public failure of the project API; it carries a code and never a diagnosis. */
export class McpProjectError extends Error {
  public readonly code: McpProjectErrorCode;
  public readonly status: number;

  /**
   * Creates the error.
   *
   * @param code - The error code of the interface; it decides the HTTP status.
   */
  public constructor(code: McpProjectErrorCode) {
    super("The project request was rejected.");
    this.name = "McpProjectError";
    this.code = code;
    this.status = STATUS_OF_CODE[code];
  }
}

/**
 * Translates a failure of the project services into the error of the interface.
 *
 * @param error - Whatever a service threw.
 * @returns The interface error, or `null` for a failure that is not the
 * client's doing and stays an internal error.
 *
 * @remarks
 * A missing right and a department outside the account's own range are
 * `forbidden`; a project the account cannot see is `not_found`, exactly like
 * one that does not exist; a rejected value is `invalid_request`.
 */
export function toMcpProjectError(error: unknown): McpProjectError | null {
  if (error instanceof McpProjectError) return error;
  if (
    error instanceof ProjectManagementDeniedError ||
    error instanceof WorkItemAccessDeniedError
  )
    return new McpProjectError("forbidden");
  if (
    error instanceof ProjectNotFoundError ||
    error instanceof ProjectAccessDeniedError
  )
    return new McpProjectError("not_found");
  if (error instanceof ProjectDepartmentError)
    return new McpProjectError(
      error.code === "departmentOutOfScope" ? "forbidden" : "invalid_request",
    );
  if (error instanceof WorkItemValidationError)
    return new McpProjectError("invalid_request");
  return null;
}
