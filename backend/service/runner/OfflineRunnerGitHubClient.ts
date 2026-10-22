import type { RunnerDeployKeyRepository } from "@/backend/database/repositories/runner/RunnerDeployKeyRepository";
import type {
  RunnerGitHubClient,
  RunnerGitHubResult,
} from "@/definition/RunnerGitHub";
import type { RunnerGitHubContext } from "./RunnerGitHubContext";

/** Default production mode: uses Pages state exclusively and never makes a network request. */
export class OfflineRunnerGitHubClient implements RunnerGitHubClient {
  private readonly keys: RunnerDeployKeyRepository;
  private readonly context: RunnerGitHubContext;
  public constructor(
    keys: RunnerDeployKeyRepository,
    context: RunnerGitHubContext,
  ) {
    this.keys = keys;
    this.context = context;
  }

  /** Registers the public key in Pages, explicitly as offline state. */
  public async createKey(input: {
    readonly projectId: string;
    readonly key: string;
    readonly title: string;
  }): Promise<RunnerGitHubResult> {
    const repository = await this.context.repository(input.projectId);
    return {
      mode: "offline",
      accessible: null,
      repository,
      key: await this.keys.create(input),
    };
  }

  /** Inspects a key recorded in Pages; never presents it as remotely verified. */
  public async checkKey(
    projectId: string,
    keyId: string,
  ): Promise<RunnerGitHubResult> {
    const repository = await this.context.repository(projectId);
    const keys = await this.keys.list(projectId);
    return {
      mode: "offline",
      accessible: null,
      repository,
      key: keys.find((key) => key.id === keyId) ?? null,
    };
  }

  /** Returns configured repository metadata, with remote access left unknown. */
  public async checkAccess(projectId: string): Promise<RunnerGitHubResult> {
    return {
      mode: "offline",
      accessible: null,
      key: null,
      repository: await this.context.repository(projectId),
    };
  }
}
