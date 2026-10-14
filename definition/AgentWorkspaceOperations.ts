/** Reads of registered agent workspaces; Pages returns only those of projects the account may open. */
export const AGENT_WORKSPACE_READ_OPERATIONS = [
  "workspaces.list",
  "workspaces.read",
] as const;

/** Changes of the workspace registry; they handle metadata and never touch a directory. */
export const AGENT_WORKSPACE_WRITE_OPERATIONS = [
  "workspaces.create",
  "workspaces.update",
  "workspaces.remove",
] as const;

export type AgentWorkspaceReadOperation =
  (typeof AGENT_WORKSPACE_READ_OPERATIONS)[number];
export type AgentWorkspaceWriteOperation =
  (typeof AGENT_WORKSPACE_WRITE_OPERATIONS)[number];

/** Why a registered workspace cannot be used for a run at the moment. */
export const AGENT_WORKSPACE_UNAVAILABLE_REASONS = [
  "project_unavailable",
  "github_link_missing",
  "path_invalid",
  "path_unavailable",
  "path_not_allowed",
  "path_changed",
] as const;

export type AgentWorkspaceUnavailableReason =
  (typeof AGENT_WORKSPACE_UNAVAILABLE_REASONS)[number];

/** The GitHub repository of the project; it is read from the project and never set here. */
export interface AgentWorkspaceGitHub {
  readonly repoUrl: string;
  readonly repoName: string | null;
}

/**
 * A workspace as an MCP client reads it, with what the planning of agent work needs.
 *
 * @remarks
 * `id` is stable for the life of the registration. `revision` is the value to
 * pass as `expectedRevision` to a change.
 */
export interface AgentWorkspaceEntry {
  readonly id: string;
  readonly name: string;
  /** Canonical absolute path of the local directory. */
  readonly path: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly github: AgentWorkspaceGitHub | null;
  readonly revision: number;
  /** Whether the directory and the project link allow a run right now. */
  readonly isUsable: boolean;
  readonly unavailableReason: AgentWorkspaceUnavailableReason | null;
  /** Whether this account may change or remove the workspace. */
  readonly canManage: boolean;
}

/** One page of the workspaces the account may open. */
export interface AgentWorkspaceList {
  readonly workspaces: readonly AgentWorkspaceEntry[];
  readonly total: number;
  readonly nextCursor: string | null;
}

/** A single workspace, found by its identifier. */
export interface AgentWorkspaceRead {
  readonly workspace: AgentWorkspaceEntry;
}

/** Result of a create, update or remove; the same result is returned when the operation is repeated. */
export interface AgentWorkspaceChanged {
  readonly id: string;
  readonly projectId: string;
  /** `false` when the request matched the registration and nothing was written. */
  readonly changed: boolean;
  /** Revision after the change; `null` once the registration is removed. */
  readonly revision: number | null;
  readonly removed: boolean;
}

export type AgentWorkspaceReadResult = AgentWorkspaceList | AgentWorkspaceRead;
