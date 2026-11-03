import { AgentError } from "@/backend/error/AgentErrors";
import { probeGitHubWriteAccess } from "@/backend/github/GitHubGitAccess";
import { decryptGitHubToken } from "@/backend/github/GitHubTokenCrypto";
import { registerLogSecret } from "@/backend/logging/LogRedaction";
import { parseGitHubRepository } from "@/backend/service/github/GitHubSyncContextLoader";
import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";

import type { AgentGitBridgeSetting } from "@/backend/config/AgentGitBridgeConfig";
import type { GitHubWriteAccess } from "@/backend/github/GitHubGitAccess";
import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import type { ResolvedAgentWorkspace } from "@/definition/AgentWorkspace";
import type { AgentWorkspaceService } from "./AgentWorkspaceService";

/** A live, server-only credential result; never part of a plan snapshot or response. */
export type AgentPlanGitHubAccess =
  | {
      readonly status: "available";
      readonly repository: string;
      readonly token: string;
      /** What GitHub answered at session start; advisory, Git's own answer decides. */
      readonly writeAccess: GitHubWriteAccess;
    }
  | { readonly status: "unavailable"; readonly reason: string };

/** The authority of one session's Git bridge; server-only and never part of a snapshot. */
export interface AgentPlanGitBridgeGrant {
  readonly repository: string;
  readonly sshAlias: string;
  readonly pushRefs: readonly string[];
  /** Checks live access again; the bridge asks before every transfer. */
  readonly isAuthorized: () => Promise<boolean>;
}

/** The plan step a session runs for. */
export interface AgentPlanGitBridgeExecution {
  readonly planId: string;
  readonly stepId: string;
}

interface GitHubDependencies {
  readonly projects: Pick<
    ProjectRepository,
    "findIntegration" | "findTokenEncrypted"
  >;
  readonly workspaces: Pick<
    AgentWorkspaceService,
    "resolve" | "requireManagement"
  >;
  readonly tokenKey: Buffer;
  /** Asks GitHub about the token before a session starts; defaults to the real network. */
  readonly probeWriteAccess?: typeof probeGitHubWriteAccess;
  /** Operator configuration; missing means no session gets a bridge. */
  readonly gitBridges?: readonly AgentGitBridgeSetting[];
}

function repositoryName(repoUrl: string): string | null {
  const repo = parseGitHubRepository(repoUrl);
  if (
    !repo ||
    !/^[a-z\d-]+\/[a-z\d_.-]+$/iu.test(`${repo.owner}/${repo.repo}`) ||
    [".", ".."].includes(repo.repo)
  )
    return null;
  return `${repo.owner}/${repo.repo}`;
}

/** Resolves only the selected workspace project's encrypted GitHub connection after live authorization. */
export class AgentPlanGitHubCredentials {
  private readonly dependencies: GitHubDependencies;

  public constructor(dependencies: GitHubDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Resolves write credentials for an explicitly authorized YOLO node.
   *
   * @remarks
   * Project management is the existing GitHub write boundary. Missing credentials
   * or write access leave GitHub unavailable without blocking unrelated shell work.
   * Synchronization settings do not authorize or prohibit repository operations.
   * A token GitHub rejects at session start stays in place: the probe only
   * describes it, so it can never take access from a working token.
   */
  public async resolve(
    userId: string,
    expected: ResolvedAgentWorkspace,
  ): Promise<AgentPlanGitHubAccess> {
    const { projects, workspaces } = this.dependencies;
    const workspace = await workspaces.resolve(
      userId,
      expected.id,
      expected.projectId,
    );
    if (
      workspace.path !== expected.path ||
      workspace.directoryIdentity !== expected.directoryIdentity ||
      workspace.github?.repoUrl !== expected.github?.repoUrl
    )
      throw new AgentError("plan_context_changed");
    if (!(await this.canWrite(userId, workspace.projectId)))
      return { status: "unavailable", reason: "project write access required" };
    const integration = await projects.findIntegration(workspace.projectId);
    if (!integration || integration.repoUrl !== workspace.github?.repoUrl)
      throw new AgentError("plan_context_changed");
    const repository = repositoryName(integration.repoUrl);
    if (!repository)
      return {
        status: "unavailable",
        reason: "invalid project GitHub repository",
      };
    const encrypted = await projects.findTokenEncrypted(workspace.projectId);
    if (!encrypted)
      return {
        status: "unavailable",
        reason: "project GitHub token not configured",
      };
    return this.tokenAccess(repository, encrypted);
  }

  /**
   * Selects the host Git route of a session, when an operator named exactly this step.
   *
   * @param userId - The executor of the run.
   * @param expected - The workspace of the step.
   * @param execution - The plan and step the session runs for.
   * @returns The grant, or `null` without a matching entry or without live access.
   *
   * @remarks
   * The entry must name the project, the plan, the step and the repository of
   * the project's own integration, and the executor must still manage the
   * project. Nothing here reads or returns a host credential.
   */
  public async resolveBridge(
    userId: string,
    expected: ResolvedAgentWorkspace,
    execution: AgentPlanGitBridgeExecution,
  ): Promise<AgentPlanGitBridgeGrant | null> {
    const setting = this.dependencies.gitBridges?.find(
      (entry) =>
        entry.projectId === expected.projectId &&
        entry.planId === execution.planId &&
        entry.stepId === execution.stepId,
    );
    if (!setting) return null;
    const isAuthorized = (): Promise<boolean> =>
      this.isBridgeAuthorized(userId, expected, setting);
    if (!(await isAuthorized())) {
      logDiagnostic(
        "AgentPlanGitHubCredentials",
        "warn",
        "A configured Git bridge stays off: the executor manages no such project, or the integration names another repository.",
      );
      return null;
    }
    const { repository, sshAlias, pushRefs } = setting;
    return { repository, sshAlias, pushRefs, isAuthorized };
  }

  private async isBridgeAuthorized(
    userId: string,
    expected: ResolvedAgentWorkspace,
    setting: AgentGitBridgeSetting,
  ): Promise<boolean> {
    const { projects, workspaces } = this.dependencies;
    const workspace = await workspaces.resolve(
      userId,
      expected.id,
      expected.projectId,
    );
    if (
      workspace.path !== expected.path ||
      workspace.directoryIdentity !== expected.directoryIdentity ||
      !(await this.canWrite(userId, workspace.projectId))
    )
      return false;
    const integration = await projects.findIntegration(workspace.projectId);
    return (
      integration !== null &&
      repositoryName(integration.repoUrl) === setting.repository
    );
  }

  private async tokenAccess(
    repository: string,
    encrypted: string,
  ): Promise<AgentPlanGitHubAccess> {
    let token: string;
    try {
      token = decryptGitHubToken(encrypted, this.dependencies.tokenKey);
    } catch (caughtError: unknown) {
      logCaughtError("AgentPlanGitHubCredentials", caughtError);

      return {
        status: "unavailable",
        reason: "project GitHub token cannot be decrypted",
      };
    }
    if (!token || /\s/u.test(token))
      return {
        status: "unavailable",
        reason: "project GitHub token invalid",
      };
    registerLogSecret(token);
    const probe = this.dependencies.probeWriteAccess ?? probeGitHubWriteAccess;
    return {
      status: "available",
      repository,
      token,
      writeAccess: await probe(repository, token),
    };
  }

  private async canWrite(userId: string, projectId: string): Promise<boolean> {
    try {
      await this.dependencies.workspaces.requireManagement(userId, projectId);
      return true;
    } catch (error: unknown) {
      logCaughtError("AgentPlanGitHubCredentials", error);

      if (
        !(error instanceof AgentError) ||
        error.code !== "workspace_management_denied"
      )
        throw error;
      return false;
    }
  }
}
