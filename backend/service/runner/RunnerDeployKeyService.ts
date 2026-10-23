import { z } from "zod";

import { parseHostKey } from "@/backend/remote/SshHostKey";

import type { AgentWorkspaceService } from "@/backend/service/agents/AgentWorkspaceService";
import type { RemoteWorkspaceService } from "@/backend/service/remote/RemoteWorkspaceService";
import type { RemoteConnectionService } from "@/backend/service/remote/RemoteConnectionService";
import type { RunnerGitHubAccessService } from "./RunnerGitHubAccessService";
import type { RunnerGitHubContext } from "./RunnerGitHubContext";
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
  private readonly remote:
    | {
        readonly workspaces: RemoteWorkspaceService;
        readonly connections: RemoteConnectionService;
        readonly access: RunnerGitHubAccessService;
        readonly context: RunnerGitHubContext;
      }
    | undefined;
  public constructor(
    client: RunnerGitHubClient,
    workspaces: AgentWorkspaceService,
    remote?: {
      readonly workspaces: RemoteWorkspaceService;
      readonly connections: RemoteConnectionService;
      readonly access: RunnerGitHubAccessService;
      readonly context: RunnerGitHubContext;
    },
  ) {
    this.client = client;
    this.workspaces = workspaces;
    this.remote = remote;
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

  /** Checks the runner's own SSH key using read and non-mutating dry-run probes. */
  public async checkRunnerAccess(
    userId: string,
    workspaceId: string,
  ): Promise<RunnerGitHubResult> {
    if (!this.remote) throw new Error("Remote key inspection unavailable");
    const workspace = (await this.remote.workspaces.list(userId)).find(
      (entry) => entry.id === workspaceId,
    );
    if (!workspace) throw new Error("Remote workspace unavailable");
    await this.workspaces.requireManagement(userId, workspace.projectId);
    await this.remote.connections.requireSetup(userId, workspace.connectionId);
    const repository = await this.remote.context.repository(
      workspace.projectId,
    );
    try {
      const result = await this.remote.access.execute(
        userId,
        workspace.connectionId,
        repository,
      );
      const readAccess = result.read.allowed;
      const writeAccess = result.write.allowed;
      let accessStatus: RunnerGitHubResult["accessStatus"] = "unverifiable";
      if (readAccess === false) accessStatus = "no_access";
      if (readAccess === true && writeAccess === false)
        accessStatus = "read_only";
      if (readAccess === true && writeAccess === true)
        accessStatus = "read_write";
      return {
        mode: "ssh",
        key: null,
        repository,
        accessible: readAccess,
        readAccess,
        writeAccess,
        accessStatus,
        readReason: result.read.reason,
        writeReason: result.write.reason,
      };
    } catch {
      return {
        mode: "ssh",
        key: null,
        repository,
        accessible: null,
        readAccess: null,
        writeAccess: null,
        accessStatus: "unverifiable",
        readReason: "unavailable",
        writeReason: "unavailable",
      };
    }
  }
}
