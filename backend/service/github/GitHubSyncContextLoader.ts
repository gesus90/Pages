import { decryptGitHubToken } from "@/backend/github/GitHubTokenCrypto";

import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import type { GitHubApiClient } from "@/backend/github/GitHubApiClient";
import type { ProjectIntegration } from "@/definition/Project";

/** A GitHub repository address split into owner and name. */
export interface GitHubRepositoryRef {
  readonly owner: string;
  readonly repo: string;
}

/** Authenticated sync prerequisites resolved for one project. */
export interface GitHubSyncContext {
  readonly integration: ProjectIntegration;
  readonly repo: GitHubRepositoryRef;
  readonly client: GitHubApiClient;
}

/** Options controlling which integrations resolve to a sync context. */
export interface FindSyncContextOptions {
  readonly allowTokenless?: boolean;
}

/**
 * Splits a repository address into its owner and name segments.
 *
 * @param repoUrl - Repository address from the integration settings.
 * @returns Owner and name, or `null` when the address is invalid.
 */
export function parseGitHubRepository(
  repoUrl: string,
): GitHubRepositoryRef | null {
  const match = repoUrl
    .trim()
    .match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(\.git)?\/?$/);

  if (!match?.[1] || !match?.[2]) {
    return null;
  }

  return { owner: match[1], repo: match[2] };
}

/** Resolves the repository, token, and API client a synchronization needs. */
export class GitHubSyncContextLoader {
  private readonly projectRepository: ProjectRepository;
  private readonly createClient: (token: string) => GitHubApiClient;
  private readonly tokenKey: Buffer;

  /**
   * Creates a sync context loader.
   *
   * @param projectRepository - Project persistence boundary holding the integration.
   * @param createClient - Factory building an API client for a token.
   * @param tokenKey - Key decrypting the stored access token.
   */
  public constructor(
    projectRepository: ProjectRepository,
    createClient: (token: string) => GitHubApiClient,
    tokenKey: Buffer,
  ) {
    this.projectRepository = projectRepository;
    this.createClient = createClient;
    this.tokenKey = tokenKey;
  }

  /**
   * Resolves the sync context of a project.
   *
   * @param projectId - Project owning the integration.
   * @param options - Whether integrations without a stored token still resolve.
   * @returns The context, or `null` when the project is not connected.
   */
  public async findContext(
    projectId: string,
    options: FindSyncContextOptions = {},
  ): Promise<GitHubSyncContext | null> {
    const integration = await this.projectRepository.findIntegration(projectId);

    if (!integration || !integration.repoUrl) {
      return null;
    }

    const repo = parseGitHubRepository(integration.repoUrl);

    if (!repo) {
      return null;
    }

    const encrypted =
      await this.projectRepository.findTokenEncrypted(projectId);

    if (!encrypted) {
      return options.allowTokenless
        ? { client: this.createClient(""), integration, repo }
        : null;
    }

    return {
      client: this.createClient(decryptGitHubToken(encrypted, this.tokenKey)),
      integration,
      repo,
    };
  }

  /**
   * Resolves the sync context of a project that must be connected.
   *
   * @param projectId - Project owning the integration.
   * @throws {Error} When the project has no usable connected integration.
   */
  public async requireContext(projectId: string): Promise<GitHubSyncContext> {
    const sync = await this.findContext(projectId);

    if (!sync) {
      throw new Error("GitHub integration is not connected.");
    }

    return sync;
  }
}
