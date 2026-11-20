import { expect, it, vi } from "vitest";

import { GitHubApiClient, GitHubApiError } from "./GitHubApiClient";

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));

const issue = {
  number: 1,
  title: "Title",
  body: null,
  state: "open",
  html_url: "https://example.invalid/1",
  updated_at: "today",
};
const pull = { ...issue, merged_at: "today", head: { ref: "branch" } };

it("loads and filters paginated issues and writes issue changes", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () =>
        Array.from({ length: 100 }, () => ({ ...issue, pull_request: {} })),
    })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [issue] })
    .mockResolvedValue({ ok: true, status: 200, json: async () => issue });
  const client = new GitHubApiClient("synthetic", request);
  expect(await client.listIssues("owner", "repo")).toEqual([
    expect.objectContaining({ number: 1, body: "" }),
  ]);
  expect(request).toHaveBeenCalledTimes(2);
  expect(await client.getIssue("owner", "repo", 1)).toMatchObject({
    number: 1,
  });
  expect(
    await client.createIssue("owner", "repo", { title: "Title", body: "Body" }),
  ).toMatchObject({ number: 1 });
  expect(
    await client.updateIssue("owner", "repo", 1, { state: "closed" }),
  ).toMatchObject({ number: 1 });
  expect(request).toHaveBeenLastCalledWith(
    expect.stringContaining("/issues/1"),
    expect.objectContaining({ method: "PATCH", body: '{"state":"closed"}' }),
  );
});

it("validates repository and pull request responses", async () => {
  const request = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => [pull, { ...pull, head: null, merged_at: null }],
  });
  const client = new GitHubApiClient("synthetic", request);
  expect(await client.listPullRequests("owner", "repo")).toEqual([
    expect.objectContaining({ branch: "branch", merged: true }),
    expect.objectContaining({ branch: null, merged: false }),
  ]);
  request.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ full_name: "owner/repo" }),
  });
  expect(await client.getRepository("owner", "repo")).toBe("owner/repo");
  request.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => null,
  });
  await expect(client.getRepository("owner", "repo")).rejects.toBeInstanceOf(
    GitHubApiError,
  );
  request.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({}),
  });
  await expect(client.listPullRequests("owner", "repo")).rejects.toThrow(
    "pull request list",
  );
  request.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({}),
  });
  await expect(client.listIssues("owner", "repo")).rejects.toThrow(
    "issue list",
  );
});

it("reports transport, HTTP and malformed-data failures", async () => {
  const request = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ message: " denied " }),
    })
    .mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("bad json");
      },
    });
  const client = new GitHubApiClient("synthetic", request);
  await expect(client.getIssue("o", "r", 1)).rejects.toThrow("offline");
  await expect(client.getIssue("o", "r", 1)).rejects.toThrow("403: denied");
  await expect(client.getIssue("o", "r", 1)).rejects.toThrow("status 500");
  for (const invalid of [
    null,
    { ...issue, number: 1.5 },
    { ...issue, title: null },
    { ...issue, state: "unknown" },
  ]) {
    request.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => invalid,
    });
    await expect(client.getIssue("o", "r", 1)).rejects.toBeInstanceOf(
      GitHubApiError,
    );
  }
});

it("handles default transport and malformed pull request and rejection bodies", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => issue,
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new GitHubApiClient("synthetic");
  expect(await client.getIssue("o", "r", 1)).toMatchObject({ number: 1 });
  expect(fetchMock).toHaveBeenCalledOnce();

  for (const body of [null, {}, { message: "  " }, { message: 4 }]) {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => body,
    });
    await expect(client.getIssue("o", "r", 1)).rejects.toThrow("status 400.");
  }
  fetchMock.mockRejectedValueOnce("offline");
  await expect(client.getIssue("o", "r", 1)).rejects.toThrow(
    "GitHub could not be reached.",
  );
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => [null],
  });
  await expect(client.listPullRequests("o", "r")).rejects.toThrow(
    "without a pull request",
  );
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => [{ ...pull, head: {}, merged_at: undefined }],
  });
  expect(await client.listPullRequests("o", "r")).toEqual([
    expect.objectContaining({ branch: null, merged: false }),
  ]);
});

it("preserves a supplied issue body", async () => {
  const request = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ...issue, body: "text" }),
  });
  expect(
    await new GitHubApiClient("synthetic", request).getIssue("o", "r", 1),
  ).toMatchObject({ body: "text" });
});
