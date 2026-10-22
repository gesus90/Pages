import { z } from "zod";

import { parseHostKey } from "@/backend/remote/SshHostKey";

import type { AgentWorkspaceService } from "@/backend/service/agents/AgentWorkspaceService";
import type {
  RunnerGitHubClient,
  RunnerGitHubResult,
} from "@/definition/RunnerGitHub";

const keyInputSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(1).max(120),
  key: z
    .string()
    .trim()
    .max(4096)
    .regex(
      /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256) [A-Za-z0-9+/]+={0,3}(?: [^\r\n]+)?$/u,
    ),
});

/** Applies existing project management rights before every deploy-key operation. */
export class RunnerDeployKeyService {
  private readonly client: RunnerGitHubClient;
  private readonly workspaces: AgentWorkspaceService;
  public constructor(
    client: RunnerGitHubClient,
    workspaces: AgentWorkspaceService,
  ) {
    this.client = client;
    this.workspaces = workspaces;
  }

  /** Registers a public key and immediately checks its persisted identity through the same client. */
  public async register(
    userId: string,
    input: unknown,
  ): Promise<RunnerGitHubResult> {
    const validated = keyInputSchema.parse(input);
    const publicKey = parseHostKey(
      validated.key.split(/\s+/u).slice(0, 2).join(" "),
    );
    if (!publicKey) throw new Error("Invalid SSH public key");
    const normalized = {
      ...validated,
      key: `${publicKey.algorithm} ${publicKey.key}`,
    };
    await this.workspaces.requireManagement(userId, validated.projectId);
    const access = await this.client.checkAccess(validated.projectId);
    if (access.accessible === false)
      throw new Error("Repository access denied");
    const created = await this.client.createKey(normalized);
    if (!created.key) throw new Error("Deploy key registration failed");
    const checked = await this.client.checkKey(
      validated.projectId,
      created.key.id,
    );
    if (
      checked.key?.key.split(" ").slice(0, 2).join(" ") !==
      validated.key.split(" ").slice(0, 2).join(" ")
    )
      throw new Error("Deploy key verification failed");
    return { ...checked, accessible: access.accessible };
  }

  /** Checks the current repository configuration or authenticated HTTP access, depending on mode. */
  public async checkAccess(
    userId: string,
    projectId: string,
  ): Promise<RunnerGitHubResult> {
    await this.workspaces.requireManagement(userId, projectId);
    return this.client.checkAccess(projectId);
  }
}
