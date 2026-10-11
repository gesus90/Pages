import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type { AgentProfileDirectory } from "./AgentProfile";

/** Usage grants never grant project access or workspace administration. */
export interface AgentWorkspaceTarget {
  readonly kind: "person" | "group" | "department";
  readonly targetId: string;
}

/** A registration refers to an existing directory; it contains no Git credentials. */
export interface AgentWorkspaceInput {
  readonly name: string;
  readonly path: string;
  readonly projectId: string;
  readonly targets: readonly AgentWorkspaceTarget[];
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

/** Authorized selection metadata also explains a directory that has become unavailable. */
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

/** Only administrators receive grant lists and editing hints. */
export interface AgentWorkspaceView extends AgentWorkspaceChoice {
  readonly revision: number;
  readonly canManage: boolean;
  readonly targets: readonly AgentWorkspaceTarget[];
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

/** References block unregistering or rebinding a workspace, but not withdrawing usage grants. */
export interface AgentWorkspaceUsage {
  readonly id: string;
  readonly name: string;
}

/** Page metadata is filtered before reaching the browser. */
export interface AgentWorkspacePage {
  readonly canManage: boolean;
  readonly isConfigured: boolean;
  readonly workspaces: readonly AgentWorkspaceView[];
  readonly projects: readonly {
    readonly id: string;
    readonly name: string;
    readonly github: WorkspaceGitHub | null;
  }[];
  readonly directory: AgentProfileDirectory;
}
