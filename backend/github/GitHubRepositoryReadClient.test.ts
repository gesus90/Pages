import { expect, it, vi } from "vitest";

import { GitHubRepositoryReadClient } from "./GitHubRepositoryReadClient";

const commit = {
  sha: "abc",
  commit: { message: "message", author: null },
  parents: [],
};
const file = {
  filename: "a.txt",
  status: "modified",
  additions: 1,
  deletions: 0,
};
const comparison = {
  total_commits: 2,
  commits: [commit],
  files: [file, { ...file, filename: "b.txt", patch: "diff" }],
  status: "ahead",
  ahead_by: 2,
  behind_by: 0,
};

it("reads paginated history, comparisons and changed files", async () => {
  const request = vi.fn<typeof fetch>();
  request.mockResolvedValueOnce(Response.json(comparison));
  request.mockResolvedValueOnce(Response.json([commit]));
  request.mockResolvedValueOnce(Response.json([]));
  request.mockResolvedValueOnce(Response.json(comparison));
  request.mockResolvedValueOnce(Response.json({ ...commit, files: [file] }));
  const client = new GitHubRepositoryReadClient(
    "owner/repo",
    "secret",
    request,
  );
  expect(await client.log({ range: "a..b", page: 1, limit: 1 })).toMatchObject({
    order: "oldest_first",
    nextPage: 2,
  });
  expect(await client.log({ commit: "abc", page: 1, limit: 1 })).toMatchObject({
    order: "newest_first",
    nextPage: 2,
  });
  expect(await client.log({ page: 2, limit: 1 })).toMatchObject({
    nextPage: null,
  });
  expect(await client.diff("a", "b")).toMatchObject({
    missingPatches: ["a.txt"],
    filesMayBeTruncated: false,
  });
  expect(await client.show("abc", 1, 1)).toMatchObject({
    nextPage: 2,
    missingPatches: ["a.txt"],
  });
  expect(request.mock.calls[0]?.[0]).toContain(
    "/compare/a...b?page=1&per_page=1",
  );
});

it("reads and redacts file contents and escapes path components", async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      type: "file",
      sha: "abc",
      size: 12,
      encoding: "base64",
      content: Buffer.from("secret data").toString("base64"),
    }),
  );
  const client = new GitHubRepositoryReadClient(
    "owner/repo",
    "secret",
    request,
  );
  expect(await client.file("abc", "dir/a b.txt")).toMatchObject({
    text: "[REDACTED] data",
  });
  expect(request.mock.calls[0]?.[0]).toContain(
    "/contents/dir/a%20b.txt?ref=abc",
  );
});

it("rejects malformed, unavailable and oversized responses", async () => {
  const request = vi.fn<typeof fetch>();
  const client = new GitHubRepositoryReadClient("owner/repo", "", request);
  for (const call of [
    () => client.log({ range: "a..b", page: 1, limit: 1 }),
    () => client.log({ page: 1, limit: 1 }),
    () => client.diff("a", "b"),
    () => client.show("a", 1, 1),
    () => client.file("a", "b"),
  ]) {
    request.mockResolvedValueOnce(Response.json({}));
    await expect(call()).rejects.toThrow();
  }
  request.mockResolvedValueOnce(new Response("bad", { status: 403 }));
  await expect(client.diff("a", "b")).rejects.toThrow();
  request.mockResolvedValueOnce(new Response(null));
  await expect(client.diff("a", "b")).rejects.toThrow();
  request.mockRejectedValueOnce(new Error("offline"));
  await expect(client.diff("a", "b")).rejects.toThrow();
  request.mockResolvedValueOnce(new Response("{"));
  await expect(client.diff("a", "b")).rejects.toThrow();
  request.mockResolvedValueOnce(new Response("x".repeat(512 * 1024 + 1)));
  await expect(client.diff("a", "b")).rejects.toThrow();
  for (const fileContent of [
    { size: 128 * 1024 + 1, content: "" },
    { size: 1, content: Buffer.alloc(128 * 1024 + 1).toString("base64") },
  ]) {
    request.mockResolvedValueOnce(
      Response.json({
        type: "file",
        sha: "a",
        encoding: "base64",
        ...fileContent,
      }),
    );
    await expect(client.file("a", "b")).rejects.toThrow();
  }
});

it("handles the last comparison page and absent or complete file lists", async () => {
  const request = vi.fn<typeof fetch>();
  request.mockResolvedValueOnce(
    Response.json({ ...comparison, total_commits: 1 }),
  );
  request.mockResolvedValueOnce(
    Response.json({ ...comparison, files: undefined }),
  );
  request.mockResolvedValueOnce(Response.json({ ...commit, files: [] }));
  const client = new GitHubRepositoryReadClient("owner/repo", "token", request);
  expect(await client.log({ range: "a..b", page: 1, limit: 1 })).toMatchObject({
    nextPage: null,
  });
  expect(await client.diff("a", "b")).toMatchObject({
    files: [],
    missingPatches: [],
  });
  expect(await client.show("a", 1, 1)).toMatchObject({ nextPage: null });
});
