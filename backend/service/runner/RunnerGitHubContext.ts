import { decryptGitHubToken } from "@/backend/github/GitHubTokenCrypto";
import { registerLogSecret } from "@/backend/logging/LogRedaction";
import { parseGitHubRepository } from "@/backend/service/github/GitHubSyncContextLoader";

import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";

/** Reads project repository metadata and protected tokens only on the server. */
export class RunnerGitHubContext {
  private readonly projects: ProjectRepository;
  private readonly tokenKey: Buffer;
  public constructor(projects: ProjectRepository, tokenKey: Buffer) {
    this.projects = projects;
    this.tokenKey = tokenKey;
  }

  /** Resolves the configured repository without decrypting credentials. */
  public async repository(projectId: string): Promise<string> {
    const integration = await this.projects.findIntegration(projectId);
    const parsed = integration
      ? parseGitHubRepository(integration.repoUrl)
      : null;
    if (
      !parsed ||
      !/^[a-z\d-]+\/[a-z\d_.-]+$/iu.test(`${parsed.owner}/${parsed.repo}`) ||
      [".", ".."].includes(parsed.repo)
    )
      throw new Error("Project GitHub repository required");
    return `${parsed.owner}/${parsed.repo}`;
  }

  /** Decrypts the existing project token for a single HTTP operation. */
  public async token(projectId: string): Promise<string> {
    const encrypted = await this.projects.findTokenEncrypted(projectId);
    if (!encrypted) throw new Error("Project GitHub token required");
    const token = decryptGitHubToken(encrypted, this.tokenKey);
    if (!token || /\s/u.test(token))
      throw new Error("Invalid project GitHub token");
    registerLogSecret(token);
    return token;
  }
}
