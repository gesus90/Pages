import { AdministrationError } from "@/backend/error/AdministrationError";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";

import { McpWorkspaceError } from "../workspace/McpWorkspaceError";

import type { AgentEmployeeErrorCode } from "@/backend/error/AgentEmployeeError";
import type { McpWorkspaceErrorCode } from "../workspace/McpWorkspaceError";

/** Error codes of the agent API, as the interface names them (PAGE-267). */
export type McpAgentErrorCode =
  | "invalid_token"
  | "forbidden"
  | "not_found"
  | "invalid_request"
  | "conflict"
  | "username_taken"
  | "model_not_allowed"
  | "running";

const STATUS_OF_CODE: Readonly<Record<McpAgentErrorCode, number>> = {
  conflict: 409,
  forbidden: 403,
  invalid_request: 400,
  invalid_token: 401,
  model_not_allowed: 422,
  not_found: 404,
  running: 409,
  username_taken: 409,
};

const EMPLOYEE_ERROR_CODES: Readonly<
  Record<AgentEmployeeErrorCode, McpAgentErrorCode>
> = {
  accessUnsupported: "invalid_request",
  accessAdminRequired: "forbidden",
  isolationUnavailable: "invalid_request",
  busy: "running",
  conflict: "conflict",
  forbidden: "forbidden",
  inactive: "invalid_request",
  invalidInput: "invalid_request",
  modelNotAllowed: "model_not_allowed",
  notFound: "not_found",
  templateNameTaken: "conflict",
  unavailable: "model_not_allowed",
  usernameTaken: "username_taken",
  stopped: "running",
};

/** The codes of the shared body reader of the MCP routes that the agent API answers as they are. */
const WORKSPACE_ERROR_CODES: Readonly<
  Partial<Record<McpWorkspaceErrorCode, McpAgentErrorCode>>
> = {
  invalid_request: "invalid_request",
  invalid_token: "invalid_token",
  not_found: "not_found",
};

/**
 * Fixed public failure of the agent API.
 *
 * @remarks
 * It carries a code, a status and, for `conflict`, the current revision of
 * the agent; neither a message of the services nor any part of the request
 * leaves the server through it.
 */
export class McpAgentError extends Error {
  public readonly code: McpAgentErrorCode;
  public readonly status: number;
  /** The current revision of the agent, for `conflict`. */
  public readonly revision: number | null;

  /**
   * Creates the error.
   *
   * @param code - The error code of the interface; it decides the HTTP status.
   * @param revision - The current revision of the agent, for `conflict`.
   */
  public constructor(code: McpAgentErrorCode, revision: number | null = null) {
    super("The agent request was rejected.");
    this.name = "McpAgentError";
    this.code = code;
    this.status = STATUS_OF_CODE[code];
    this.revision = revision;
  }
}

/**
 * Translates a failure of the agent services into the error of the interface.
 *
 * @param error - Whatever a service or the request reader threw.
 * @returns The interface error, or `null` for a failure that is not the
 * client's doing and stays an internal error.
 */
export function toMcpAgentError(error: unknown): McpAgentError | null {
  if (error instanceof McpAgentError) return error;
  if (error instanceof AgentEmployeeError)
    return new McpAgentError(EMPLOYEE_ERROR_CODES[error.code]);
  if (error instanceof AdministrationError) {
    if (error.code === "notFound") return new McpAgentError("not_found");
    if (error.code === "invalidInput")
      return new McpAgentError("invalid_request");
    return new McpAgentError("forbidden");
  }
  if (error instanceof McpWorkspaceError) {
    const code = WORKSPACE_ERROR_CODES[error.code];
    return code === undefined ? null : new McpAgentError(code);
  }
  return null;
}
