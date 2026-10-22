import { REMOTE_ERROR_CODES } from "@/definition/RemoteConnection";

import type {
  RemoteErrorCode,
  RemoteFailureDetail,
} from "@/definition/RemoteConnection";

/** HTTP status of each remote error that is not a plain input error. */
const REMOTE_ERROR_STATUS: Partial<Record<RemoteErrorCode, number>> = {
  remote_access_denied: 403,
  remote_management_denied: 403,
  remote_project_denied: 403,
  remote_connection_not_found: 404,
  remote_workspace_not_found: 404,
  remote_connection_name_taken: 409,
  remote_connection_in_use: 409,
  remote_conflict: 409,
  remote_workspace_path_conflict: 409,
  remote_project_unsupported: 409,
  remote_host_key_unconfirmed: 409,
  remote_check_failed: 409,
  remote_reconnecting: 409,
  remote_blocked: 409,
  remote_transport_lost: 409,
  remote_setup_installed: 409,
  remote_setup_registered: 409,
  remote_setup_running: 409,
  remote_setup_unstable: 409,
  remote_setup_failed: 409,
};

/**
 * A refused or failed remote action with a stable code.
 *
 * @remarks
 * The message is the code itself, so neither a secret nor native SSH output
 * can reach a log or the browser through it.
 */
export class RemoteError extends Error {
  public readonly code: RemoteErrorCode;
  /** The classified cause of a failed check or connect, when there is one. */
  public readonly failure: RemoteFailureDetail | null;

  public constructor(
    code: RemoteErrorCode,
    failure: RemoteFailureDetail | null = null,
  ) {
    super(code);
    this.name = "RemoteError";
    this.code = code;
    this.failure = failure;
  }
}

/** Narrows a value to a remote error code. */
export function isRemoteErrorCode(value: unknown): value is RemoteErrorCode {
  return REMOTE_ERROR_CODES.some((code) => code === value);
}

/** Returns the HTTP status of a remote error. */
export function remoteErrorStatus(code: RemoteErrorCode): number {
  return REMOTE_ERROR_STATUS[code] ?? 400;
}
