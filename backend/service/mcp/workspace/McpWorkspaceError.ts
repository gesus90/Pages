import { AgentError } from "@/backend/error/AgentErrors";
import { RemoteError } from "@/backend/error/RemoteErrors";

import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type {
  RemoteErrorCode,
  RemoteFailureDetail,
} from "@/definition/RemoteConnection";

/** Error codes of the workspace API, as the interface names them. */
export type McpWorkspaceErrorCode =
  | "invalid_token"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "name_taken"
  | "path_conflict"
  | "project_unsupported"
  | "in_use"
  | "running"
  | "host_key_mismatch"
  | "host_key_unconfirmed"
  | "connection_unavailable"
  | "check_failed"
  | "roots_missing"
  | "path_invalid"
  | "roots_invalid"
  | "secret_required"
  | "invalid_request";

/** Why a local path is not usable: the code of the interface without its prefix. */
const LOCAL_PATH_DETAILS = [
  "invalid",
  "unavailable",
  "denied",
  "contains_instance",
  "outside_roots",
  "changed",
] as const;

/** A finding of a local path check. */
export type McpLocalPathDetail = (typeof LOCAL_PATH_DETAILS)[number];

/** The stable finding some answers add to their code. */
export type McpWorkspaceDetail = RemoteFailureDetail | McpLocalPathDetail;

const STATUS_OF_CODE: Readonly<Record<McpWorkspaceErrorCode, number>> = {
  check_failed: 409,
  conflict: 409,
  connection_unavailable: 409,
  forbidden: 403,
  host_key_mismatch: 409,
  host_key_unconfirmed: 409,
  in_use: 409,
  invalid_request: 400,
  invalid_token: 401,
  name_taken: 409,
  not_found: 404,
  path_conflict: 409,
  path_invalid: 400,
  project_unsupported: 409,
  roots_invalid: 400,
  roots_missing: 409,
  running: 409,
  secret_required: 400,
};

/** Codes of the remote services that carry the finding of their cause. */
const REMOTE_DETAIL_CODES: ReadonlySet<McpWorkspaceErrorCode> = new Set([
  "check_failed",
  "connection_unavailable",
]);

const REMOTE_ERROR_CODES: Readonly<
  Partial<Record<RemoteErrorCode, McpWorkspaceErrorCode>>
> = {
  remote_access_denied: "forbidden",
  remote_blocked: "connection_unavailable",
  remote_check_failed: "check_failed",
  remote_conflict: "conflict",
  remote_connection_in_use: "in_use",
  remote_connection_invalid: "invalid_request",
  remote_connection_name_taken: "name_taken",
  remote_connection_not_found: "not_found",
  remote_department_invalid: "not_found",
  remote_host_key_invalid: "invalid_request",
  remote_host_key_unconfirmed: "host_key_unconfirmed",
  remote_management_denied: "forbidden",
  remote_project_denied: "forbidden",
  remote_project_unsupported: "project_unsupported",
  remote_reconnecting: "connection_unavailable",
  remote_roots_invalid: "roots_invalid",
  remote_secret_required: "secret_required",
  remote_transport_lost: "connection_unavailable",
  remote_workspace_invalid: "invalid_request",
  remote_workspace_not_found: "not_found",
  remote_workspace_path_conflict: "path_conflict",
  remote_workspace_running: "running",
};

const WORKSPACE_ERROR_CODES: Readonly<
  Partial<Record<AgentErrorCode, McpWorkspaceErrorCode>>
> = {
  workspace_access_denied: "forbidden",
  workspace_conflict: "conflict",
  workspace_in_use: "in_use",
  workspace_invalid: "invalid_request",
  workspace_management_denied: "forbidden",
  workspace_not_found: "not_found",
  workspace_path_conflict: "path_conflict",
  workspace_project_unsupported: "project_unsupported",
  workspace_roots_missing: "roots_missing",
  workspace_running: "running",
};

const LOCAL_PATH_PREFIX = "workspace_path_";

/**
 * Fixed public failure of the workspace API.
 *
 * @remarks
 * It carries a code, a status and at most a stable finding; neither a
 * message of the services nor any part of the request leaves the server
 * through it.
 */
export class McpWorkspaceError extends Error {
  public readonly code: McpWorkspaceErrorCode;
  public readonly status: number;
  public readonly detail: McpWorkspaceDetail | null;

  /**
   * Creates the error.
   *
   * @param code - The error code of the interface; it decides the HTTP status.
   * @param detail - The stable finding that explains the code, if the interface names one.
   */
  public constructor(
    code: McpWorkspaceErrorCode,
    detail: McpWorkspaceDetail | null = null,
  ) {
    super("The workspace request was rejected.");
    this.name = "McpWorkspaceError";
    this.code = code;
    this.status = STATUS_OF_CODE[code];
    this.detail = detail;
  }
}

function isLocalPathDetail(value: string): value is McpLocalPathDetail {
  return LOCAL_PATH_DETAILS.some((detail) => detail === value);
}

/** The finding of a remote failure; only some codes name one. */
function remoteDetail(
  code: McpWorkspaceErrorCode,
  error: RemoteError,
): McpWorkspaceDetail | null {
  if (REMOTE_DETAIL_CODES.has(code)) return error.failure;
  if (code === "invalid_request" && error.failure === "key_invalid")
    return "key_invalid";
  return null;
}

function fromRemoteError(error: RemoteError): McpWorkspaceError | null {
  const code = REMOTE_ERROR_CODES[error.code];
  return code === undefined
    ? null
    : new McpWorkspaceError(code, remoteDetail(code, error));
}

function fromAgentError(error: AgentError): McpWorkspaceError | null {
  const code = WORKSPACE_ERROR_CODES[error.code];
  if (code !== undefined) return new McpWorkspaceError(code);
  if (!error.code.startsWith(LOCAL_PATH_PREFIX)) return null;
  const detail = error.code.slice(LOCAL_PATH_PREFIX.length);
  return isLocalPathDetail(detail)
    ? new McpWorkspaceError("path_invalid", detail)
    : null;
}

/**
 * Translates a failure of the workspace and connection services into the error of the interface.
 *
 * @param error - Whatever a service threw.
 * @returns The interface error, or `null` for a failure that is not the
 * client's doing and stays an internal error.
 *
 * @remarks
 * A missing right is `forbidden`; a workspace, project or connection the
 * account cannot see is `not_found`, exactly like one that does not exist.
 */
export function toMcpWorkspaceError(error: unknown): McpWorkspaceError | null {
  if (error instanceof McpWorkspaceError) return error;
  if (error instanceof RemoteError) return fromRemoteError(error);
  if (error instanceof AgentError) return fromAgentError(error);
  return null;
}

/**
 * Runs a call that names a project of the request and answers a hidden one like a missing one.
 *
 * @remarks
 * The registry reports a project the account cannot open as an access
 * failure; for a project the request names, the interface calls that `not_found`.
 *
 * @param work - The call that reads or uses the project.
 * @throws {McpWorkspaceError} `not_found` when the project is hidden or missing.
 */
export async function hideInvisibleProject<Result>(
  work: () => Promise<Result>,
): Promise<Result> {
  try {
    return await work();
  } catch (error: unknown) {
    if (error instanceof AgentError && error.code === "workspace_access_denied")
      throw new McpWorkspaceError("not_found");
    throw error;
  }
}
