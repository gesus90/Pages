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

/** What still refers to a workspace and therefore blocks unregistering or rebinding it. */
export type AgentWorkspaceUsageKind = "agent" | "plan" | "run";

/**
 * A reference that blocks unregistering or rebinding a workspace.
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
