import { AdministrationError } from "@/backend/error/AdministrationError";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import {
  EmailTakenError,
  UsernameTakenError,
} from "@/backend/error/UserErrors";
import { OperationReusedError } from "@/backend/service/InterfaceOperationJournal";
import { McpWorkspaceError } from "@/backend/service/mcp/workspace/McpWorkspaceError";

import type { AdministrationErrorCode } from "@/backend/error/AdministrationError";

/** Error codes of the user management API (PAGE-280). */
export type McpUserErrorCode =
  | "invalid_token"
  | "forbidden"
  | "not_found"
  | "invalid_request"
  | "too_many_targets"
  | "conflict"
  | "confirmation_required"
  | "in_use"
  | "last_administrator"
  | "last_membership"
  | "username_taken"
  | "email_taken";

/** What a call would change; the answer of `confirmation_required`. */
export interface McpUserConfirmation {
  readonly target: { readonly type: string; readonly id: string };
  /** Machine-readable effects, such as `permissions_removed`. */
  readonly effects: readonly string[];
  readonly affectedUserIds: readonly string[];
  /** The words a person types; the client passes the exact reply as `confirmation`. */
  readonly words: readonly string[];
}

const STATUS_OF_CODE: Readonly<Record<McpUserErrorCode, number>> = {
  confirmation_required: 428,
  conflict: 409,
  email_taken: 409,
  forbidden: 403,
  in_use: 409,
  invalid_request: 400,
  invalid_token: 401,
  last_administrator: 409,
  last_membership: 409,
  not_found: 404,
  too_many_targets: 400,
  username_taken: 409,
};

const ADMINISTRATION_CODES: Readonly<
  Record<AdministrationErrorCode, McpUserErrorCode>
> = {
  agentInUse: "in_use",
  forbidden: "forbidden",
  inUse: "in_use",
  invalidInput: "invalid_request",
  lastAdministrator: "last_administrator",
  lastMembership: "last_membership",
  notFound: "not_found",
};

const OPERATION_CODES: Readonly<
  Partial<Record<AgentOperationError["code"], McpUserErrorCode>>
> = {
  CONFLICT: "conflict",
  FORBIDDEN: "forbidden",
  INVALID_REQUEST: "invalid_request",
  NOT_FOUND: "not_found",
  PAYLOAD_TOO_LARGE: "too_many_targets",
};

/**
 * Fixed public failure of the user management API.
 *
 * @remarks
 * It carries a code and, for `confirmation_required`, what the call would
 * change. Neither a message of a service nor any part of the request leaves
 * the server through it, so a temporary password never can either.
 */
export class McpUserError extends Error {
  public readonly code: McpUserErrorCode;
  public readonly status: number;
  public readonly confirmation: McpUserConfirmation | null;

  /**
   * Creates the error.
   *
   * @param code - The error code of the interface; it decides the HTTP status.
   * @param confirmation - What needs a confirmation, for `confirmation_required`.
   */
  public constructor(
    code: McpUserErrorCode,
    confirmation: McpUserConfirmation | null = null,
  ) {
    super("The user management request was rejected.");
    this.name = "McpUserError";
    this.code = code;
    this.status = STATUS_OF_CODE[code];
    this.confirmation = confirmation;
  }

  /** The body of the answer. */
  public toBody(): Readonly<Record<string, unknown>> {
    return this.confirmation === null
      ? { error: this.code }
      : { error: this.code, confirmation: this.confirmation };
  }
}

/**
 * Translates a failure of the administration services into the error of the interface.
 *
 * @param error - Whatever a service, a parser or the token check threw.
 * @returns The interface error, or `null` for a failure that is not the
 * client's doing and stays an internal error.
 */
export function toMcpUserError(error: unknown): McpUserError | null {
  if (error instanceof McpUserError) return error;
  if (error instanceof AdministrationError)
    return new McpUserError(ADMINISTRATION_CODES[error.code]);
  if (error instanceof UsernameTakenError)
    return new McpUserError("username_taken");
  if (error instanceof EmailTakenError) return new McpUserError("email_taken");
  if (error instanceof OperationReusedError)
    return new McpUserError("conflict");
  if (error instanceof McpAuthorizationError)
    return new McpUserError("invalid_token");
  // The shared body reader of the MCP routes refuses a body with these.
  if (error instanceof McpWorkspaceError)
    return error.code === "not_found"
      ? new McpUserError("not_found")
      : new McpUserError("invalid_request");
  if (error instanceof AgentOperationError) {
    const code = OPERATION_CODES[error.code];
    return code === undefined ? null : new McpUserError(code);
  }
  return null;
}
