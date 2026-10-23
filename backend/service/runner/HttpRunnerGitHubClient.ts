import { z } from "zod";

import type {
  RunnerDeployKey,
  RunnerGitHubClient,
  RunnerGitHubResult,
} from "@/definition/RunnerGitHub";
import type { RunnerGitHubContext } from "./RunnerGitHubContext";

const deployKeySchema = z.object({
  id: z.number().int().positive(),
  key: z.string(),
  title: z.string(),
  read_only: z.boolean(),
});
const repositorySchema = z.object({ full_name: z.string() });

function readKey(input: unknown): RunnerDeployKey {
  const key = deployKeySchema.parse(input);
  return {
    id: String(key.id),
    key: key.key,
    title: key.title,
    readOnly: key.read_only,
  };
}

/** Explicit opt-in GitHub HTTP implementation; construction alone never performs I/O. */
export class HttpRunnerGitHubClient implements RunnerGitHubClient {
  private readonly context: RunnerGitHubContext;
  public constructor(context: RunnerGitHubContext) {
    this.context = context;
  }

  /** Creates a read-only deploy key, reusing an exact existing key on repeated registration. */
  public async createKey(input: {
    readonly projectId: string;
    readonly key: string;
    readonly title: string;
  }): Promise<RunnerGitHubResult> {
    const repository = await this.context.repository(input.projectId);
    const existing = await this.findKey(input.projectId, input.key);
    const key =
      existing ??
      readKey(
        await this.request({
          projectId: input.projectId,
          suffix: "/keys",
          body: { key: input.key, title: input.title, read_only: true },
        }),
      );
    if (
      key.key.split(" ").slice(0, 2).join(" ") !==
      input.key.split(" ").slice(0, 2).join(" ")
    )
      throw new Error("GitHub deploy key mismatch");
    return { mode: "http", accessible: null, repository, key };
  }

  /** Looks up an exact key ID and reports its actual read-only policy. */
  public async checkKey(
    projectId: string,
    keyId: string,
  ): Promise<RunnerGitHubResult> {
    if (!/^\d+$/u.test(keyId)) throw new Error("Invalid deploy key ID");
    const result = await this.request({ projectId, suffix: `/keys/${keyId}` });
    return {
      mode: "http",
      accessible: null,
      repository: await this.context.repository(projectId),
      key: result === null ? null : readKey(result),
    };
  }

  /** Checks authenticated repository metadata access; SSH access with the private key is separate. */
  public async checkAccess(
    projectId: string,
    publicKey?: string,
  ): Promise<RunnerGitHubResult> {
    const repository = await this.context.repository(projectId);
    const result = await this.request({ projectId, suffix: "" });
    const accessible =
      result !== null &&
      repositorySchema.parse(result).full_name.toLowerCase() ===
        repository.toLowerCase();
    const key = publicKey ? await this.findKey(projectId, publicKey) : null;
    return {
      mode: "http",
      accessible,
      key,
      repository,
      readAccess: key ? true : null,
      writeAccess: key ? key.readOnly === false : null,
    };
  }

  private async findKey(
    projectId: string,
    publicKey: string,
  ): Promise<RunnerDeployKey | null> {
    for (let page = 1; page <= 100; page += 1) {
      const result = await this.request({
        projectId,
        suffix: `/keys?per_page=100&page=${page}`,
      });
      const keys = z.array(deployKeySchema).parse(result);
      const existing = keys.find(
        (key) =>
          key.key.split(" ").slice(0, 2).join(" ") ===
          publicKey.split(" ").slice(0, 2).join(" "),
      );
      if (existing) return readKey(existing);
      if (keys.length < 100) return null;
    }
    throw new Error("GitHub deploy key pagination limit exceeded");
  }

  private async request(input: {
    readonly projectId: string;
    readonly suffix: string;
    readonly body?: unknown;
  }): Promise<unknown> {
    const repository = await this.context.repository(input.projectId);
    const token = await this.context.token(input.projectId);
    const response = await fetch(
      `https://api.github.com/repos/${repository}${input.suffix}`,
      {
        method: input.body === undefined ? "GET" : "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "Pages-Runner",
          "Content-Type": "application/json",
        },
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
      },
    );
    if (response.status === 404 && input.body === undefined) return null;
    if (!response.ok)
      throw new Error(`GitHub operation failed (${response.status})`);
    return response.json();
  }
}
