import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import type { GitHubSyncAccessGuard } from "@/backend/service/github/GitHubSyncAccessGuard";
import type { GitHubSyncContextLoader } from "@/backend/service/github/GitHubSyncContextLoader";
import type { ProjectIntegration } from "@/definition/Project";
import type { User } from "@/definition/User";

/** What a connection test stores on the integration of a project. */
interface ConnectionResult {
  readonly isConnected: boolean;
  readonly repoName: string | null;
}

/** Verifies stored GitHub connections against the GitHub API. */
export class GitHubConnectionTester {
  private readonly projectRepository: ProjectRepository;
  private readonly accessGuard: GitHubSyncAccessGuard;
  private readonly contextLoader: GitHubSyncContextLoader;

  /**
   * Creates a connection tester.
   *
   * @param projectRepository - Project persistence boundary storing the result.
   * @param accessGuard - Verifier of write permission on the project.
   * @param contextLoader - Resolver of the repository, token, and client.
   */
  public constructor(
    projectRepository: ProjectRepository,
    accessGuard: GitHubSyncAccessGuard,
    contextLoader: GitHubSyncContextLoader,
  ) {
    this.projectRepository = projectRepository;
    this.accessGuard = accessGuard;
    this.contextLoader = contextLoader;
  }

  /**
   * Verifies the stored connection against the GitHub API.
   *
   * @param actor - User testing the connection; must hold write permission.
   * @param projectId - Project to verify.
   * @returns Whether GitHub accepted the stored token and address.
   */
  public async testConnection(
    actor: User,
    projectId: string,
  ): Promise<boolean> {
    await this.accessGuard.requireWritableProject(actor, projectId);

    const sync = await this.contextLoader.findContext(projectId, {
      allowTokenless: true,
    });

    if (!sync) {
      return false;
    }

    try {
      const repositoryName = await sync.client.getRepository(
        sync.repo.owner,
        sync.repo.repo,
      );

      await this.persistConnectionResult(sync.integration, projectId, {
        isConnected: true,
        repoName: repositoryName,
      });

      return true;
    } catch {
      await this.persistConnectionResult(sync.integration, projectId, {
        isConnected: false,
        repoName: sync.integration.repoName,
      });

      return false;
    }
  }

  private async persistConnectionResult(
    integration: ProjectIntegration,
    projectId: string,
    result: ConnectionResult,
  ): Promise<void> {
    await this.projectRepository.upsertIntegration(projectId, {
      isConnected: result.isConnected,
      lastSyncAt: integration.lastSyncAt,
      repoName: result.repoName,
      repoUrl: integration.repoUrl,
      syncComments: integration.syncComments,
      syncCommits: integration.syncCommits,
      syncDirection: integration.syncDirection,
      syncIntervalMinutes: integration.syncIntervalMinutes,
      syncIssues: integration.syncIssues,
      syncPullRequests: integration.syncPullRequests,
      syncStatus: integration.syncStatus,
      tokenEncrypted: null,
      tokenHash: null,
    });
  }
}
