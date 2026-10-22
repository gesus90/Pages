import type { Department } from "@/definition/Authorization";
import type { WorkspaceGitHub } from "@/definition/AgentWorkspace";

/** How Pages signs in to a remote machine; separate from every Codex, Claude or OpenCode login. */
export const REMOTE_AUTH_METHODS = [
  "password",
  "key",
  "key_passphrase",
] as const;

/** One of the three SSH sign-in methods. */
export type RemoteAuthMethod = (typeof REMOTE_AUTH_METHODS)[number];

/**
 * Why reaching, verifying or signing in to a remote machine failed.
 *
 * @remarks
 * Stable codes cross the HTTP boundary; the text of the SSH tools never does,
 * so no secret, path or banner of the remote machine reaches the browser.
 */
export const REMOTE_FAILURE_CODES = [
  "host_unknown",
  "unreachable_refused",
  "unreachable_timeout",
  "unreachable_network",
  "not_ssh",
  "host_key_unconfirmed",
  "host_key_changed",
  "host_key_unavailable",
  "password_rejected",
  "key_rejected",
  "passphrase_wrong",
  "passphrase_required",
  "key_invalid",
  "secret_missing",
  "ssh_unavailable",
  "transport_lost",
  "remote_failed",
] as const;

/** A classified failure of a connection test, a connect or a remote command. */
export type RemoteFailureCode = (typeof REMOTE_FAILURE_CODES)[number];

/** Why a remote directory cannot serve as a workspace, found by the check over SSH. */
export const REMOTE_PATH_ISSUES = [
  "path_missing",
  "path_not_directory",
  "path_denied",
  "path_not_readable",
  "path_not_writable",
  "path_not_traversable",
  "path_changed",
  "path_outside_roots",
] as const;

/** A finding of the remote directory check. */
export type RemotePathIssue = (typeof REMOTE_PATH_ISSUES)[number];

/** Stable error codes of the remote connection and remote workspace actions. */
export const REMOTE_ERROR_CODES = [
  "remote_access_denied",
  "remote_management_denied",
  "remote_connection_invalid",
  "remote_connection_not_found",
  "remote_connection_name_taken",
  "remote_connection_in_use",
  "remote_department_invalid",
  "remote_secret_required",
  "remote_host_key_invalid",
  "remote_host_key_unconfirmed",
  "remote_roots_invalid",
  "remote_conflict",
  "remote_workspace_invalid",
  "remote_workspace_not_found",
  "remote_workspace_path_conflict",
  "remote_project_unsupported",
  "remote_project_denied",
  "remote_check_failed",
  "remote_reconnecting",
  "remote_blocked",
  "remote_transport_lost",
] as const;

/** A stable error of a remote action. */
export type RemoteErrorCode = (typeof REMOTE_ERROR_CODES)[number];

/** The part of a remote action that failed and its classified cause, when known. */
export type RemoteFailureDetail = RemoteFailureCode | RemotePathIssue;

/** How many allowed directories one connection may list. */
export const MAXIMUM_REMOTE_ROOTS = 20;

/**
 * The directories workspace profiles of a connection must lie in.
 *
 * @param allowedRoots - The connection's list; it may be empty.
 * @param username - The SSH user of the connection.
 * @returns The list, or the user's home `/home/<username>` when it is empty.
 */
export function effectiveRemoteRoots(
  allowedRoots: readonly string[],
  username: string,
): readonly string[] {
  return allowedRoots.length > 0 ? allowedRoots : [`/home/${username}`];
}

/** Narrows an external value to an SSH sign-in method. */
export function isRemoteAuthMethod(value: unknown): value is RemoteAuthMethod {
  return REMOTE_AUTH_METHODS.some((method) => method === value);
}

/** Narrows a stored or external value to a classified SSH failure. */
export function isRemoteFailureCode(
  value: unknown,
): value is RemoteFailureCode {
  return REMOTE_FAILURE_CODES.some((code) => code === value);
}

/** Narrows a stored value to a finding of the remote directory check. */
export function isRemotePathIssue(value: unknown): value is RemotePathIssue {
  return REMOTE_PATH_ISSUES.some((issue) => issue === value);
}

/**
 * A host key as Pages pins it for every later connection.
 *
 * @remarks
 * The key is public; the fingerprint is the SHA-256 form that `ssh-keygen -l`
 * prints, so a person can compare it with the target machine.
 */
export interface RemoteHostKey {
  readonly algorithm: string;
  /** The base64 key blob as in a `known_hosts` line. */
  readonly key: string;
  readonly fingerprint: string;
}

/**
 * What the connection dialog sends.
 *
 * @remarks
 * Secrets travel only from the browser to the server and are never sent back.
 * When a connection is edited, an empty secret field keeps the stored secret.
 */
export interface RemoteConnectionInput {
  readonly name: string;
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly authMethod: RemoteAuthMethod;
  readonly departmentId: string;
  readonly password: string;
  readonly privateKey: string;
  readonly passphrase: string;
  /** The host key confirmed in the dialog as `algorithm base64`; `null` keeps the pinned one. */
  readonly hostKey: string | null;
  /** Absolute directories workspaces must lie in; empty allows only `/home/<username>`. */
  readonly allowedRoots: readonly string[];
  readonly revision?: number;
}

/** The stage of a connection test, in the order it runs. */
export type RemoteTestStage = "reachability" | "host_key" | "authentication";

/** One stage of a connection test; later stages are skipped after a failure. */
export interface RemoteTestStep {
  readonly state: "passed" | "failed" | "skipped";
  readonly code: RemoteFailureCode | null;
}

/** What "Test connection" found, stage by stage, without any native SSH text. */
export interface RemoteTestResult {
  readonly reachability: RemoteTestStep;
  readonly hostKey: RemoteTestStep;
  readonly authentication: RemoteTestStep;
  /** The key the machine presented, so a person can confirm or compare it. */
  readonly presentedHostKey: RemoteHostKey | null;
  readonly testedAt: string;
}

/** The latest stored test or connect of a connection. */
export interface RemoteConnectionCheck {
  readonly checkedAt: string;
  /** The stage that failed; `null` when every stage passed. */
  readonly stage: RemoteTestStage | null;
  readonly code: RemoteFailureCode | null;
}

/** States of the logical connection; a transport change never changes a stored record. */
export type RemoteSessionStatus =
  "idle" | "connecting" | "connected" | "reconnecting" | "blocked";

/**
 * The live logical SSH connection of a remote connection.
 *
 * @remarks
 * After a transport loss, or a first connect that fails because the machine
 * is not reachable or its host key is not confirmed yet, Pages reconnects with
 * at most {@link RemoteSessionView.maximumAttempts} attempts at growing
 * intervals; after the last failure the connection stays blocked until a
 * person starts a new series.
 */
export interface RemoteSessionView {
  readonly status: RemoteSessionStatus;
  /** Failed attempts of the current series. */
  readonly attempts: number;
  readonly maximumAttempts: number;
  readonly nextAttemptAt: string | null;
  readonly cause: RemoteFailureCode | null;
  readonly connectedAt: string | null;
}

/** Which secrets are stored, shown only to those who manage the connection. */
export interface RemoteStoredSecrets {
  readonly password: boolean;
  readonly privateKey: boolean;
  readonly passphrase: boolean;
}

/** A remote connection as a person who may use or manage it sees it; never with a secret. */
export interface RemoteConnectionView {
  readonly id: string;
  readonly name: string;
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly authMethod: RemoteAuthMethod;
  readonly departmentId: string;
  /** `null` when the department no longer exists. */
  readonly departmentName: string | null;
  readonly hostKey: RemoteHostKey | null;
  /** The configured allowed directories; empty means the SSH user's home only. */
  readonly allowedRoots: readonly string[];
  readonly lastCheck: RemoteConnectionCheck | null;
  /** Whether a background test of the stored connection is running. */
  readonly isChecking: boolean;
  readonly session: RemoteSessionView;
  readonly workspaceCount: number;
  readonly revision: number;
  readonly canManage: boolean;
  /** Membership in the shared department; the administrator role alone does not open a console. */
  readonly canOpenConsole: boolean;
  /** `null` for people who only use the connection. */
  readonly storedSecrets: RemoteStoredSecrets | null;
}

/** What registering or changing a remote workspace profile sends. */
export interface RemoteWorkspaceInput {
  readonly name: string;
  readonly connectionId: string;
  /** Absolute path on the remote machine; the check stores its canonical form. */
  readonly path: string;
  readonly projectId: string;
  readonly revision?: number;
}

/** The latest directory check of a remote workspace. */
export interface RemoteWorkspaceCheck {
  readonly checkedAt: string;
  /** `null` when the directory exists and is readable, writable and traversable. */
  readonly issue: RemoteFailureDetail | null;
}

/** Why a remote workspace cannot be used right now. */
export type RemoteWorkspaceReason =
  | RemoteFailureDetail
  | "project_unavailable"
  | "github_missing"
  | "connection_blocked"
  | "unchecked";

/** A remote workspace profile; several profiles of one connection stay separate records. */
export interface RemoteWorkspaceView {
  readonly id: string;
  readonly name: string;
  readonly connectionId: string;
  readonly connectionName: string;
  /** Public SSH destination displayed in the console; never contains credentials. */
  readonly consoleAddress?: string;
  /** Canonical absolute path on the remote machine. */
  readonly path: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly github: WorkspaceGitHub | null;
  readonly check: RemoteWorkspaceCheck | null;
  /**
   * Whether the connection's allowed directories changed since the stored
   * check; the stored state stays until someone checks again.
   */
  readonly isCheckOutdated: boolean;
  readonly isUsable: boolean;
  readonly reason: RemoteWorkspaceReason | null;
  readonly revision: number;
  readonly canManage: boolean;
  /** Explicit department and project grant; absent for command-only consumers. */
  readonly canOpenConsole?: boolean;
}

/** A connection a person may choose when registering a remote workspace. */
export interface RemoteConnectionChoice {
  readonly id: string;
  readonly name: string;
  readonly host: string;
  /** A connection without a confirmed host key cannot check a directory. */
  readonly hasHostKey: boolean;
  /** The directories a profile on this connection must lie in. */
  readonly allowedRoots: readonly string[];
}

/** The remote part of the working-directory page, filtered on the server. */
export interface RemoteOverview {
  /** Only administrators configure connections and their credentials. */
  readonly canManageConnections: boolean;
  readonly connections: readonly RemoteConnectionView[];
  /** The departments a connection can be shared with; empty for non-administrators. */
  readonly departments: readonly Department[];
  readonly workspaces: readonly RemoteWorkspaceView[];
  readonly choices: readonly RemoteConnectionChoice[];
}

/** Result of a remote action as the page receives it. */
export type RemoteActionResult =
  | {
      readonly ok: true;
      readonly intent: string;
      readonly test?: RemoteTestResult;
    }
  | {
      readonly ok: false;
      readonly intent: string;
      readonly error: RemoteErrorCode | "general";
      readonly failure: RemoteFailureDetail | null;
    };
