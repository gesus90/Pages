import { AgentError } from "@/backend/error/AgentErrors";
import { decryptGitHubToken } from "@/backend/github/GitHubTokenCrypto";
import { parseGitHubRepository } from "@/backend/service/github/GitHubSyncContextLoader";
import { logCaughtError } from "@/backend/logging/Logger";

import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import type { ResolvedAgentWorkspace } from "@/definition/AgentWorkspace";
import type { AgentWorkspaceService } from "./AgentWorkspaceService";

/** A live, server-only credential result; never part of a plan snapshot or response. */
export type AgentPlanGitHubAccess =
  | {
      readonly status: "available";
      readonly repository: string;
      readonly token: string;
    }
  | { readonly status: "unavailable"; readonly reason: string };

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
   */
  public async resolve(
    userId: string,
    expected: ResolvedAgentWorkspace,
  ): Promise<AgentPlanGitHubAccess> {
    const { projects, workspaces, tokenKey } = this.dependencies;
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
    try {
      const token = decryptGitHubToken(encrypted, tokenKey);
      if (!token || /\s/u.test(token))
        return {
          status: "unavailable",
          reason: "project GitHub token invalid",
        };
      return {
        status: "available",
        repository,
        token,
      };
    } catch (caughtError: unknown) {
      logCaughtError("AgentPlanGitHubCredentials", caughtError);

      return {
        status: "unavailable",
        reason: "project GitHub token cannot be decrypted",
      };
    }
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
