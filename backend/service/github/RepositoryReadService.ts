import { decryptGitHubToken } from "@/backend/github/GitHubTokenCrypto";
import { GitHubRepositoryReadClient } from "@/backend/github/GitHubRepositoryReadClient";
import {
  REPOSITORY_READ_SCHEMAS,
  RepositoryReadError,
} from "@/definition/RepositoryRead";

import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import type { ProjectService } from "@/backend/service/ProjectService";
import type { UserService } from "@/backend/service/UserService";
import type { RepositoryReadTool } from "@/definition/RepositoryRead";

/** Server-owned project connection and current account/project authorization. */
export interface RepositoryReadDependencies {
  readonly projects: Pick<ProjectService, "getById">;
  readonly accounts: Pick<UserService, "getById">;
  readonly repository: Pick<
    ProjectRepository,
    "findIntegration" | "findTokenEncrypted"
  >;
  readonly tokenKey: Buffer;
  readonly createClient?: (
    repository: string,
    token: string,
  ) => GitHubRepositoryReadClient;
}

/** Reads only the repository configured for a project the acting account can open. */
export class RepositoryReadService {
  private readonly dependencies: RepositoryReadDependencies;

  public constructor(dependencies: RepositoryReadDependencies) {
    this.dependencies = dependencies;
  }

  /** Validates tool input and rechecks account/project access before loading any credential. */
  public async run(
    userId: string,
    tool: RepositoryReadTool,
    input: unknown,
  ): Promise<object> {
    const parsed = REPOSITORY_READ_SCHEMAS[tool].safeParse(input);
    if (!parsed.success) throw new RepositoryReadError("INVALID_REQUEST");
    const client = await this.client(userId, parsed.data.projectId);
    switch (tool) {
      case "repository_log":
        return client.log(REPOSITORY_READ_SCHEMAS.repository_log.parse(input));
      case "repository_diff": {
        const { base, head } =
          REPOSITORY_READ_SCHEMAS.repository_diff.parse(input);
        return client.diff(base, head);
      }
      case "repository_show": {
        const { commit, page, limit } =
          REPOSITORY_READ_SCHEMAS.repository_show.parse(input);
        return client.show(commit, page, limit);
      }
      case "repository_file": {
        const { commit, path } =
          REPOSITORY_READ_SCHEMAS.repository_file.parse(input);
        return client.file(commit, path);
      }
    }
  }

  private async client(
    userId: string,
    projectId: string,
  ): Promise<GitHubRepositoryReadClient> {
    const actor = await this.dependencies.accounts.getById(userId);
    if (!actor?.isActive || actor.mustChangePassword)
      throw new RepositoryReadError("FORBIDDEN");
    try {
      await this.dependencies.projects.getById(actor, projectId);
    } catch {
      throw new RepositoryReadError("FORBIDDEN");
    }
    const integration =
      await this.dependencies.repository.findIntegration(projectId);
    const match = integration?.repoUrl?.match(
      /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/u,
    );
    const repository = match?.[1];
    if (!repository) throw new RepositoryReadError("NOT_CONNECTED");
    const encrypted =
      await this.dependencies.repository.findTokenEncrypted(projectId);
    if (!encrypted) throw new RepositoryReadError("NOT_CONNECTED");
    try {
      const token = decryptGitHubToken(encrypted, this.dependencies.tokenKey);
      return (
        this.dependencies.createClient?.(repository, token) ??
        new GitHubRepositoryReadClient(repository, token)
      );
    } catch {
      throw new RepositoryReadError("PROVIDER_UNAVAILABLE");
    }
  }
}
