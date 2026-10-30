import type { AgentErrorCode } from "@/backend/error/AgentErrors";

/** A registration refers to an existing local directory; it contains no Git credentials. */
export interface AgentWorkspaceInput {
  readonly name: string;
  readonly path: string;
  readonly projectId: string;
  readonly revision?: number;
}

/** Persistence facts stay on the server, including the registered directory identity. */
export interface AgentWorkspace extends AgentWorkspaceInput {
  readonly id: string;
  readonly directoryIdentity: string;
  readonly registeredBy: string;
  readonly revision: number;
}

/** The current project integration is linked by reference, without copying its secret. */
export interface WorkspaceGitHub {
  readonly repoUrl: string;
  readonly repoName: string | null;
}

/** Authorized selection metadata also explains a directory or project that has become unusable. */
export interface AgentWorkspaceChoice {
  /** Plan catalogs include remote registrations; absent means a local workspace. */
  readonly kind?: "local" | "remote";
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly github: WorkspaceGitHub | null;
  readonly isUsable: boolean;
  readonly reason: AgentErrorCode | null;
}

/** The management hint comes from the same policy that rechecks every mutation. */
export interface AgentWorkspaceView extends AgentWorkspaceChoice {
  readonly revision: number;
  readonly canManage: boolean;
}

/** A reauthorized working-directory contract for the later CLI runner, never a sandbox. */
export interface ResolvedAgentWorkspace {
  readonly id: string;
  readonly path: string;
  readonly directoryIdentity: string;
  readonly revision: number;
  readonly projectId: string;
  readonly github: WorkspaceGitHub | null;
}

/** Current references detach on removal; active runs retain attributed cleanup and all references block rebinding. */
export type AgentWorkspaceUsageKind = "agent" | "plan" | "run";

/**
 * A reference shown before removing or rebinding a workspace.
 *
 * @remarks
 * Only administrators receive the identifier and name of an agent or plan;
 * anyone else gets the kind alone, so a project manager learns that the
 * workspace is in use, not by whom. An execution never carries a name.
 */
export interface AgentWorkspaceUsage {
  readonly id: string | null;
  readonly name: string | null;
  readonly kind: AgentWorkspaceUsageKind;
}

/** A project that can be assigned to a workspace, with the GitHub link that makes it eligible. */
export interface AgentWorkspaceProject {
  readonly id: string;
  readonly name: string;
  readonly github: WorkspaceGitHub | null;
}

/** Page metadata is filtered before reaching the browser. */
export interface AgentWorkspacePage {
  /** Whether the person may register workspaces for at least one project. */
  readonly canManage: boolean;
  /** The central agent administration is reserved for administrators. */
  readonly isAdministrator: boolean;
  readonly isConfigured: boolean;
  readonly workspaces: readonly AgentWorkspaceView[];
  /** Only projects the person may manage; the form disables those without a GitHub link. */
  readonly projects: readonly AgentWorkspaceProject[];
}

/** A directory the folder browser offers; the path is absolute on the server. */
export interface WorkspaceFolderEntry {
  readonly name: string;
  readonly path: string;
}

/** What the folder browser asks for: one level of directories below the approved roots. */
export interface WorkspaceFolderRequest {
  /** Absolute directory to list; `null` starts at the approved roots. */
  readonly path: string | null;
  readonly showHidden: boolean;
}

/**
 * One level of server directories below an approved root.
 *
 * @remarks
 * Files and everything above the approved roots stay out of the listing, so
 * it discloses directory names only, and only where a workspace may live.
 */
export interface WorkspaceFolderListing {
  /** Absolute path of the level; `null` is the level that lists several approved roots. */
  readonly path: string | null;
  /** The way from the approved root down to this level; empty at the roots level. */
  readonly breadcrumbs: readonly WorkspaceFolderEntry[];
  /** Several approved roots exist, so the level that lists them can be opened. */
  readonly hasSeveralRoots: boolean;
  readonly folders: readonly WorkspaceFolderEntry[];
  /** More directories exist than are listed. */
  readonly isTruncated: boolean;
  /** Why this level cannot be registered, or `null` when it can. */
  readonly selectionIssue: AgentErrorCode | null;
}
