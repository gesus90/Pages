/** Remote issue data exchanged with the GitHub REST API. */
export interface GitHubIssueData {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly state: "open" | "closed";
  readonly url: string;
  readonly updatedAt: string;
}

/** Remote pull request data exchanged with the GitHub REST API. */
export interface GitHubPullRequestData {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: "open" | "closed";
  readonly merged: boolean;
  readonly branch: string | null;
  readonly updatedAt: string;
}

/** Minimal HTTP surface used by the client so tests can stub transport. */
export interface GitHubApiResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

/** Transport function performing one authenticated HTTP request. */
export type GitHubApiRequest = (
  url: string,
  options: {
    readonly method: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string;
  },
) => Promise<GitHubApiResponse>;

/** Thrown when GitHub rejects a request or answers with invalid data. */
export class GitHubApiError extends Error {
  public readonly status: number;

  public constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function defaultRequest(
  url: string,
  options: {
    readonly method: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string;
  },
): Promise<GitHubApiResponse> {
  return fetch(url, {
    body: options.body,
    headers: options.headers,
    method: options.method,
  });
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new GitHubApiError(502, `GitHub answered without a ${field}.`);
  }

  return value;
}

function readNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new GitHubApiError(502, `GitHub answered without a ${field}.`);
  }

  return value;
}

function readState(value: unknown): "open" | "closed" {
  if (value !== "open" && value !== "closed") {
    throw new GitHubApiError(502, "GitHub answered with an unknown state.");
  }

  return value;
}

function toIssueData(value: unknown): GitHubIssueData {
  if (typeof value !== "object" || value === null) {
    throw new GitHubApiError(502, "GitHub answered without an issue.");
  }

  const record = value as Record<string, unknown>;

  return {
    body: typeof record.body === "string" ? record.body : "",
    number: readNumber(record.number, "issue number"),
    state: readState(record.state),
    title: readString(record.title, "issue title"),
    updatedAt: readString(record.updated_at, "issue timestamp"),
    url: readString(record.html_url, "issue URL"),
  };
}

function toPullRequestData(value: unknown): GitHubPullRequestData {
  if (typeof value !== "object" || value === null) {
    throw new GitHubApiError(502, "GitHub answered without a pull request.");
  }

  const record = value as Record<string, unknown>;
  const head = record.head;
  const branch =
    typeof head === "object" && head !== null
      ? (head as Record<string, unknown>).ref
      : null;

  return {
    branch: typeof branch === "string" ? branch : null,
    merged: record.merged_at !== null && record.merged_at !== undefined,
    number: readNumber(record.number, "pull request number"),
    state: readState(record.state),
    title: readString(record.title, "pull request title"),
    updatedAt: readString(record.updated_at, "pull request timestamp"),
    url: readString(record.html_url, "pull request URL"),
  };
}

function toIssueList(value: unknown): GitHubIssueData[] {
  if (!Array.isArray(value)) {
    throw new GitHubApiError(502, "GitHub answered without an issue list.");
  }

  // The issues endpoint also reports pull requests; those are synchronized
  // separately, so only plain issues remain here.
  return value
    .filter(
      (entry) =>
        typeof entry !== "object" ||
        entry === null ||
        !("pull_request" in entry),
    )
    .map((entry) => toIssueData(entry));
}

function toPullRequestList(value: unknown): GitHubPullRequestData[] {
  if (!Array.isArray(value)) {
    throw new GitHubApiError(
      502,
      "GitHub answered without a pull request list.",
    );
  }

  return value.map((entry) => toPullRequestData(entry));
}

async function readRejectionMessage(
  response: GitHubApiResponse,
): Promise<string> {
  try {
    const body: unknown = await response.json();

    if (typeof body === "object" && body !== null) {
      const message = (body as Record<string, unknown>).message;

      if (typeof message === "string" && message.trim()) {
        return `GitHub rejected the request with status ${response.status}: ${message.trim()}`;
      }
    }
  } catch (error: unknown) {
    // Keep the generic status message when GitHub sends no readable error body.
    void error;
  }

  return `GitHub rejected the request with status ${response.status}.`;
}

/** Speaks to the GitHub REST API on behalf of one project integration. */
export class GitHubApiClient {
  private readonly token: string;
  private readonly request: GitHubApiRequest;

  /**
   * Creates an API client.
   *
   * @param token - Personal access token, kept inside the server process.
   * @param request - Transport performing HTTP requests, injectable for tests.
   */
  public constructor(
    token: string,
    request: GitHubApiRequest = defaultRequest,
  ) {
    this.token = token;
    this.request = request;
  }

  /** Loads issues of a repository, newest first. */
  public async listIssues(
    owner: string,
    repo: string,
    state: "all" | "open" | "closed" = "all",
  ): Promise<GitHubIssueData[]> {
    const response = await this.send(
      "GET",
      `/repos/${owner}/${repo}/issues?state=${state}&per_page=100`,
    );

    return toIssueList(response);
  }

  /** Loads a single issue by number. */
  public async getIssue(
    owner: string,
    repo: string,
    issueNumber: number,
  ): Promise<GitHubIssueData> {
    const response = await this.send(
      "GET",
      `/repos/${owner}/${repo}/issues/${issueNumber}`,
    );

    return toIssueData(response);
  }

  /** Creates an issue from a Pages task. */
  public async createIssue(
    owner: string,
    repo: string,
    input: { readonly title: string; readonly body: string },
  ): Promise<GitHubIssueData> {
    const response = await this.send("POST", `/repos/${owner}/${repo}/issues`, {
      title: input.title,
      body: input.body,
    });

    return toIssueData(response);
  }

  /** Updates title, body, or state of an existing issue. */
  public async updateIssue(
    owner: string,
    repo: string,
    issueNumber: number,
    input: {
      readonly title?: string;
      readonly body?: string;
      readonly state?: "open" | "closed";
    },
  ): Promise<GitHubIssueData> {
    const response = await this.send(
      "PATCH",
      `/repos/${owner}/${repo}/issues/${issueNumber}`,
      { ...input },
    );

    return toIssueData(response);
  }

  /** Loads pull requests of a repository, newest first. */
  public async listPullRequests(
    owner: string,
    repo: string,
    state: "all" | "open" | "closed" = "all",
  ): Promise<GitHubPullRequestData[]> {
    const response = await this.send(
      "GET",
      `/repos/${owner}/${repo}/pulls?state=${state}&per_page=100`,
    );

    return toPullRequestList(response);
  }

  /** Loads the repository metadata to verify the connection and token. */
  public async getRepository(owner: string, repo: string): Promise<string> {
    const response = await this.send("GET", `/repos/${owner}/${repo}`);

    if (typeof response !== "object" || response === null) {
      throw new GitHubApiError(502, "GitHub answered without a repository.");
    }

    return readString(
      (response as Record<string, unknown>).full_name,
      "repository name",
    );
  }

  private async send(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    let response: GitHubApiResponse;

    try {
      response = await this.request(`https://api.github.com${path}`, {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        method,
      });
    } catch (error: unknown) {
      throw new GitHubApiError(
        503,
        error instanceof Error
          ? `GitHub could not be reached: ${error.message}`
          : "GitHub could not be reached.",
      );
    }

    if (!response.ok) {
      throw new GitHubApiError(
        response.status,
        await readRejectionMessage(response),
      );
    }

    return response.json();
  }
}
