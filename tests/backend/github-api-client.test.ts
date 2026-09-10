import { describe, expect, it, vi } from "vitest";

import {
  GitHubApiClient,
  GitHubApiError,
} from "@/backend/github/GitHubApiClient";

import type { GitHubApiResponse } from "@/backend/github/GitHubApiClient";

function createResponse(
  body: unknown,
  options: { readonly ok?: boolean; readonly status?: number } = {},
): GitHubApiResponse {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: () => Promise.resolve(body),
  };
}

function createIssueBody(overrides: Record<string, unknown> = {}) {
  return {
    body: "Implement sync",
    html_url: "https://github.com/user/pages/issues/82",
    number: 82,
    state: "open",
    title: "GitHub Synchronisation implementieren",
    updated_at: "2026-09-05T14:21:00.000Z",
    ...overrides,
  };
}

describe("GitHubApiClient", () => {
  it("sends authenticated requests with API version headers", async () => {
    const request = vi.fn().mockResolvedValue(createResponse([]));
    const client = new GitHubApiClient("ghp-token", request);

    await client.listIssues("user", "pages");

    expect(request).toHaveBeenCalledWith(
      "https://api.github.com/repos/user/pages/issues?state=all&per_page=100",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer ghp-token",
          "X-GitHub-Api-Version": "2022-11-28",
        }),
        method: "GET",
      }),
    );
  });

  it("lists issues while skipping pull requests", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        createResponse([
          createIssueBody(),
          { ...createIssueBody({ number: 91 }), pull_request: {} },
        ]),
      );
    const client = new GitHubApiClient("ghp-token", request);

    const issues = await client.listIssues("user", "pages", "open");

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ number: 82, state: "open" });
  });

  it("creates, reads, and updates issues", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(createResponse(createIssueBody()))
      .mockResolvedValueOnce(createResponse(createIssueBody({ number: 83 })))
      .mockResolvedValueOnce(
        createResponse(createIssueBody({ number: 83, state: "closed" })),
      );
    const client = new GitHubApiClient("ghp-token", request);

    const read = await client.getIssue("user", "pages", 82);
    expect(read.url).toBe("https://github.com/user/pages/issues/82");

    const created = await client.createIssue("user", "pages", {
      body: "Implement sync",
      title: "GitHub Synchronisation implementieren",
    });
    expect(request).toHaveBeenLastCalledWith(
      "https://api.github.com/repos/user/pages/issues",
      expect.objectContaining({ method: "POST" }),
    );

    const updated = await client.updateIssue("user", "pages", 83, {
      state: "closed",
    });
    expect(updated.state).toBe("closed");
    expect(created.number).toBe(83);
  });

  it("lists pull requests with merge metadata", async () => {
    const request = vi.fn().mockResolvedValue(
      createResponse([
        {
          head: { ref: "feature/github-sync" },
          html_url: "https://github.com/user/pages/pull/91",
          merged_at: null,
          number: 91,
          state: "open",
          title: "GitHub Sync",
          updated_at: "2026-09-05T14:21:00.000Z",
        },
        {
          head: null,
          html_url: "https://github.com/user/pages/pull/90",
          merged_at: "2026-09-04T10:00:00.000Z",
          number: 90,
          state: "closed",
          title: "Old work",
          updated_at: "2026-09-04T10:00:00.000Z",
        },
      ]),
    );
    const client = new GitHubApiClient("ghp-token", request);

    const pullRequests = await client.listPullRequests("user", "pages");

    expect(pullRequests).toEqual([
      expect.objectContaining({
        branch: "feature/github-sync",
        merged: false,
        number: 91,
      }),
      expect.objectContaining({ branch: null, merged: true, number: 90 }),
    ]);
  });

  it("verifies repositories by full name", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(createResponse({ full_name: "user/pages" }));
    const client = new GitHubApiClient("ghp-token", request);

    await expect(client.getRepository("user", "pages")).resolves.toBe(
      "user/pages",
    );
  });

  it("rejects failed responses with their status", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        createResponse(
          { message: "Bad credentials" },
          { ok: false, status: 401 },
        ),
      );
    const client = new GitHubApiClient("ghp-token", request);

    const failure = await client
      .getRepository("user", "pages")
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(GitHubApiError);
    expect((failure as GitHubApiError).status).toBe(401);
    expect((failure as GitHubApiError).message).toContain("Bad credentials");
  });

  it("keeps the generic message when GitHub sends no readable error", async () => {
    const emptyClient = new GitHubApiClient(
      "ghp-token",
      vi.fn().mockResolvedValue(createResponse({}, { ok: false, status: 403 })),
    );

    const emptyFailure = await emptyClient
      .getRepository("user", "pages")
      .catch((error: unknown) => error);

    expect(emptyFailure).toBeInstanceOf(GitHubApiError);
    expect((emptyFailure as GitHubApiError).message).toBe(
      "GitHub rejected the request with status 403.",
    );

    const nullClient = new GitHubApiClient(
      "ghp-token",
      vi
        .fn()
        .mockResolvedValue(createResponse(null, { ok: false, status: 403 })),
    );

    const nullFailure = await nullClient
      .getRepository("user", "pages")
      .catch((error: unknown) => error);

    expect((nullFailure as GitHubApiError).message).toBe(
      "GitHub rejected the request with status 403.",
    );

    const textClient = new GitHubApiClient(
      "ghp-token",
      vi
        .fn()
        .mockResolvedValue(
          createResponse("forbidden", { ok: false, status: 403 }),
        ),
    );

    const textFailure = await textClient
      .getRepository("user", "pages")
      .catch((error: unknown) => error);

    expect((textFailure as GitHubApiError).message).toBe(
      "GitHub rejected the request with status 403.",
    );

    const invalidMessageClient = new GitHubApiClient(
      "ghp-token",
      vi
        .fn()
        .mockResolvedValue(
          createResponse({ message: 42 }, { ok: false, status: 403 }),
        ),
    );

    const invalidMessageFailure = await invalidMessageClient
      .getRepository("user", "pages")
      .catch((error: unknown) => error);

    expect((invalidMessageFailure as GitHubApiError).message).toBe(
      "GitHub rejected the request with status 403.",
    );

    const blankMessageClient = new GitHubApiClient(
      "ghp-token",
      vi
        .fn()
        .mockResolvedValue(
          createResponse({ message: "   " }, { ok: false, status: 403 }),
        ),
    );

    const blankMessageFailure = await blankMessageClient
      .getRepository("user", "pages")
      .catch((error: unknown) => error);

    expect((blankMessageFailure as GitHubApiError).message).toBe(
      "GitHub rejected the request with status 403.",
    );

    const brokenClient = new GitHubApiClient(
      "ghp-token",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: () => Promise.reject(new Error("invalid json")),
      }),
    );

    const brokenFailure = await brokenClient
      .getRepository("user", "pages")
      .catch((error: unknown) => error);

    expect(brokenFailure).toBeInstanceOf(GitHubApiError);
    expect((brokenFailure as GitHubApiError).message).toBe(
      "GitHub rejected the request with status 403.",
    );
  });

  it("reports unreachable hosts as service errors", async () => {
    const request = vi.fn().mockRejectedValue(new Error("socket hang up"));
    const client = new GitHubApiClient("ghp-token", request);

    const failure = await client
      .listIssues("user", "pages")
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(GitHubApiError);
    expect((failure as GitHubApiError).status).toBe(503);

    const stringClient = new GitHubApiClient(
      "ghp-token",
      vi.fn().mockRejectedValue("socket hang up"),
    );

    const stringFailure = await stringClient
      .listIssues("user", "pages")
      .catch((error: unknown) => error);

    expect(stringFailure).toBeInstanceOf(GitHubApiError);
    expect((stringFailure as GitHubApiError).message).toBe(
      "GitHub could not be reached.",
    );
  });

  it("uses the global fetch transport by default", async () => {
    const json = vi.fn().mockResolvedValue([]);
    const fetchStub = vi
      .fn()
      .mockResolvedValue({ json, ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchStub);

    try {
      const client = new GitHubApiClient("ghp-token");

      await expect(client.listIssues("user", "pages")).resolves.toEqual([]);
      expect(fetchStub).toHaveBeenCalledWith(
        "https://api.github.com/repos/user/pages/issues?state=all&per_page=100",
        expect.objectContaining({ method: "GET" }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects malformed payloads", async () => {
    const client = new GitHubApiClient(
      "ghp-token",
      vi.fn().mockResolvedValue(createResponse({})),
    );

    await expect(client.getIssue("user", "pages", 1)).rejects.toThrow(
      GitHubApiError,
    );

    const nullClient = new GitHubApiClient(
      "ghp-token",
      vi.fn().mockResolvedValue(createResponse(null)),
    );

    await expect(nullClient.getIssue("user", "pages", 1)).rejects.toThrow(
      "without an issue",
    );

    const listClient = new GitHubApiClient(
      "ghp-token",
      vi.fn().mockResolvedValue(createResponse({})),
    );

    await expect(listClient.listIssues("user", "pages")).rejects.toThrow(
      "issue list",
    );

    const pullClient = new GitHubApiClient(
      "ghp-token",
      vi.fn().mockResolvedValue(createResponse({})),
    );

    await expect(pullClient.listPullRequests("user", "pages")).rejects.toThrow(
      "pull request list",
    );

    const pullItemClient = new GitHubApiClient(
      "ghp-token",
      vi.fn().mockResolvedValue(createResponse([null])),
    );

    await expect(
      pullItemClient.listPullRequests("user", "pages"),
    ).rejects.toThrow("without a pull request");

    const repoClient = new GitHubApiClient(
      "ghp-token",
      vi.fn().mockResolvedValue(createResponse({})),
    );

    await expect(repoClient.getRepository("user", "pages")).rejects.toThrow(
      "repository name",
    );

    const nullRepoClient = new GitHubApiClient(
      "ghp-token",
      vi.fn().mockResolvedValue(createResponse("user/pages")),
    );

    await expect(nullRepoClient.getRepository("user", "pages")).rejects.toThrow(
      "without a repository",
    );
  });

  it("rejects issues with unknown states or missing fields", async () => {
    const stateClient = new GitHubApiClient(
      "ghp-token",
      vi
        .fn()
        .mockResolvedValue(createResponse(createIssueBody({ state: "weird" }))),
    );

    await expect(stateClient.getIssue("user", "pages", 1)).rejects.toThrow(
      "unknown state",
    );

    const titleClient = new GitHubApiClient(
      "ghp-token",
      vi.fn().mockResolvedValue(createResponse(createIssueBody({ title: 42 }))),
    );

    await expect(titleClient.getIssue("user", "pages", 1)).rejects.toThrow(
      "issue title",
    );

    const numberClient = new GitHubApiClient(
      "ghp-token",
      vi
        .fn()
        .mockResolvedValue(createResponse(createIssueBody({ number: 1.5 }))),
    );

    await expect(numberClient.getIssue("user", "pages", 1)).rejects.toThrow(
      "issue number",
    );
  });
});
