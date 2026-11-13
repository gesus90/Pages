import { z } from "zod";

import { redactCredentials } from "@/backend/security/AgentTextSafety";
import { RepositoryReadError } from "@/definition/RepositoryRead";

const MAXIMUM_RESPONSE_BYTES = 512 * 1024;
const MAXIMUM_FILE_BYTES = 128 * 1024;
const commitSchema = z.object({
  sha: z.string(),
  commit: z.object({
    message: z.string(),
    author: z.object({ name: z.string(), date: z.string() }).nullable(),
  }),
  parents: z.array(z.object({ sha: z.string() })),
});
const fileSchema = z.object({
  filename: z.string(),
  status: z.string(),
  additions: z.number(),
  deletions: z.number(),
  patch: z.string().optional(),
  previous_filename: z.string().optional(),
});
const comparisonSchema = z.object({
  total_commits: z.number(),
  commits: z.array(commitSchema),
  files: z.array(fileSchema).optional(),
  status: z.string(),
  ahead_by: z.number(),
  behind_by: z.number(),
});

/** A bounded, redirect-free GET client for the connected project repository. */
export class GitHubRepositoryReadClient {
  private readonly repository: string;
  private readonly token: string;
  private readonly request: typeof fetch;

  public constructor(
    repository: string,
    token: string,
    request: typeof fetch = fetch,
  ) {
    this.repository = repository;
    this.token = token;
    this.request = request;
  }

  /** Lists a commit range in GitHub comparison order, or history newest first. */
  public async log(input: {
    readonly range?: string;
    readonly commit?: string;
    readonly page: number;
    readonly limit: number;
  }): Promise<object> {
    if (input.range) {
      const range = input.range.replace("..", "...");
      const parsed = comparisonSchema.safeParse(
        await this.get(
          `/compare/${range}?page=${input.page}&per_page=${input.limit}`,
        ),
      );
      if (!parsed.success)
        throw new RepositoryReadError("PROVIDER_UNAVAILABLE");
      const result = parsed.data;
      return {
        commits: result.commits,
        total: result.total_commits,
        order: "oldest_first",
        nextPage:
          input.page * input.limit < result.total_commits
            ? input.page + 1
            : null,
      };
    }
    const query = new URLSearchParams({
      page: String(input.page),
      per_page: String(input.limit),
    });
    if (input.commit) query.set("sha", input.commit);
    const parsed = z
      .array(commitSchema)
      .safeParse(await this.get(`/commits?${query.toString()}`));
    if (!parsed.success) throw new RepositoryReadError("PROVIDER_UNAVAILABLE");
    return {
      commits: parsed.data,
      order: "newest_first",
      nextPage: parsed.data.length === input.limit ? input.page + 1 : null,
    };
  }

  /** Reads a bounded comparison, explicitly naming GitHub's 300-file limit and absent patches. */
  public async diff(base: string, head: string): Promise<object> {
    const parsed = comparisonSchema.safeParse(
      await this.get(`/compare/${base}...${head}?per_page=1`),
    );
    if (!parsed.success) throw new RepositoryReadError("PROVIDER_UNAVAILABLE");
    const result = parsed.data;
    const files = result.files ?? [];
    return {
      base,
      head,
      status: result.status,
      aheadBy: result.ahead_by,
      behindBy: result.behind_by,
      files,
      fileLimit: 300,
      filesMayBeTruncated: files.length >= 300,
      missingPatches: files
        .filter((file) => file.patch === undefined)
        .map((file) => file.filename),
    };
  }

  /** Shows an immutable commit and a page of its changed files. */
  public async show(
    commit: string,
    page: number,
    limit: number,
  ): Promise<object> {
    const parsed = commitSchema
      .extend({ files: z.array(fileSchema) })
      .safeParse(
        await this.get(`/commits/${commit}?page=${page}&per_page=${limit}`),
      );
    if (!parsed.success) throw new RepositoryReadError("PROVIDER_UNAVAILABLE");
    return {
      ...parsed.data,
      nextPage: parsed.data.files.length === limit ? page + 1 : null,
      missingPatches: parsed.data.files
        .filter((file) => file.patch === undefined)
        .map((file) => file.filename),
    };
  }

  /** Reads a bounded text file at a commit; never follows a raw download URL. */
  public async file(commit: string, path: string): Promise<object> {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    const parsed = z
      .object({
        type: z.literal("file"),
        sha: z.string(),
        size: z.number(),
        encoding: z.literal("base64"),
        content: z.string(),
      })
      .safeParse(await this.get(`/contents/${encoded}?ref=${commit}`));
    if (!parsed.success) throw new RepositoryReadError("PROVIDER_UNAVAILABLE");
    if (parsed.data.size > MAXIMUM_FILE_BYTES)
      throw new RepositoryReadError("TOO_LARGE");
    const bytes = Buffer.from(parsed.data.content, "base64");
    if (bytes.length > MAXIMUM_FILE_BYTES)
      throw new RepositoryReadError("TOO_LARGE");
    return {
      commit,
      path,
      sha: parsed.data.sha,
      text: this.redact(bytes.toString("utf8")),
    };
  }

  private redact(content: string): string {
    return redactCredentials(
      this.token ? content.replaceAll(this.token, "[REDACTED]") : content,
    );
  }

  private async get(path: string): Promise<unknown> {
    try {
      const response = await this.request(
        `https://api.github.com/repos/${this.repository}${path}`,
        {
          method: "GET",
          redirect: "error",
          signal: AbortSignal.timeout(15000),
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${this.token}`,
            "X-GitHub-Api-Version": "2022-11-28",
          },
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new RepositoryReadError("PROVIDER_UNAVAILABLE");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new RepositoryReadError("PROVIDER_UNAVAILABLE");
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAXIMUM_RESPONSE_BYTES) {
          await reader.cancel();
          throw new RepositoryReadError("TOO_LARGE");
        }
        chunks.push(chunk.value);
      }
      return JSON.parse(this.redact(Buffer.concat(chunks).toString("utf8")));
    } catch (error: unknown) {
      if (error instanceof RepositoryReadError) throw error;
      // A transport exception can contain headers; it must never reach a log or a caller.
      throw new RepositoryReadError("PROVIDER_UNAVAILABLE");
    }
  }
}
