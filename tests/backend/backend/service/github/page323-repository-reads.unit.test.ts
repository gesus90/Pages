import { expect, it, vi } from "vitest";

import { encryptGitHubToken } from "@/backend/github/GitHubTokenCrypto";
import { GitHubRepositoryReadClient } from "@/backend/github/GitHubRepositoryReadClient";
import { RepositoryReadService } from "@/backend/service/github/RepositoryReadService";
import { RepositoryReadError } from "@/definition/RepositoryRead";

import type { RepositoryReadDependencies } from "@/backend/service/github/RepositoryReadService";
import type { User } from "@/definition/User";
import type { Project, ProjectIntegration } from "@/definition/Project";

const TOKEN = "private-project-credential";
const KEY = Buffer.alloc(32, 7);
const ACTOR: User = {
  id: "Ed",
  username: "ed",
  displayName: "Ed",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
  isAgent: true,
};
const COMMIT = {
  sha: "3468b2db",
  commit: { message: "Changes", author: { name: "Ed", date: "2026-11-12" } },
  parents: [{ sha: "c5ee1978" }],
};
const FILE = {
  filename: "docs/report.md",
  status: "modified",
  additions: 2,
  deletions: 1,
  patch: "@@ changes @@",
};
const COMPARE = {
  commits: [COMMIT],
  total_commits: 1,
  files: [FILE],
  status: "ahead",
  ahead_by: 1,
  behind_by: 0,
};

function world(): {
  readonly request: ReturnType<typeof vi.fn<typeof fetch>>;
  readonly dependencies: RepositoryReadDependencies;
  readonly tokens: ReturnType<
    typeof vi.fn<RepositoryReadDependencies["repository"]["findTokenEncrypted"]>
  >;
  readonly account: ReturnType<
    typeof vi.fn<RepositoryReadDependencies["accounts"]["getById"]>
  >;
  readonly project: ReturnType<
    typeof vi.fn<RepositoryReadDependencies["projects"]["getById"]>
  >;
  readonly service: RepositoryReadService;
} {
  const request = vi.fn<typeof fetch>(async () => Response.json(COMPARE));
  const tokens = vi.fn<
    RepositoryReadDependencies["repository"]["findTokenEncrypted"]
  >(async () => encryptGitHubToken(TOKEN, KEY));
  const account = vi.fn<RepositoryReadDependencies["accounts"]["getById"]>(
    async () => ACTOR,
  );
  const visibleProject: Project = {
    id: "pages",
    name: "Pages",
    departments: [],
    parentId: null,
    description: "",
    status: "active",
    progress: 0,
    placeholderColor: "",
    hasIcon: false,
    managerId: null,
    managerName: null,
    startDate: null,
    targetDate: null,
    notes: "",
    createdAt: "",
    updatedAt: "",
  };
  const project = vi.fn<RepositoryReadDependencies["projects"]["getById"]>(
    async () => visibleProject,
  );
  const integration: ProjectIntegration = {
    projectId: "pages",
    repoUrl: "https://github.com/owner/pages",
    repoName: "pages",
    hasToken: true,
    syncEnabled: false,
    syncIssues: false,
    syncStatus: false,
    syncComments: false,
    syncPullRequests: false,
    syncCommits: false,
    syncDirection: "pull",
    syncIntervalMinutes: 15,
    isConnected: true,
    lastSyncAt: null,
    nextSyncAt: null,
    updatedAt: "",
  };
  const dependencies: RepositoryReadDependencies = {
    accounts: { getById: account },
    projects: { getById: project },
    repository: {
      findIntegration: async () => integration,
      findTokenEncrypted: tokens,
    },
    tokenKey: KEY,
    createClient: (repository, token) =>
      new GitHubRepositoryReadClient(repository, token, request),
  };
  return {
    dependencies,
    service: new RepositoryReadService(dependencies),
    request,
    tokens,
    account,
    project,
  };
}

it("reads the requested project range as GET without a checkout or a credential in the result", async () => {
  const testWorld = world();
  const result = await testWorld.service.run("Ed", "repository_log", {
    projectId: "pages",
    range: "c5ee1978..3468b2db",
  });
  expect(result).toEqual({
    commits: [COMMIT],
    total: 1,
    order: "oldest_first",
    nextPage: null,
  });
  expect(testWorld.project).toHaveBeenCalledWith(ACTOR, "pages");
  expect(testWorld.request).toHaveBeenCalledWith(
    "https://api.github.com/repos/owner/pages/compare/c5ee1978...3468b2db?page=1&per_page=30",
    expect.objectContaining({
      method: "GET",
      redirect: "error",
      headers: expect.objectContaining({
        Authorization: `Bearer ${TOKEN}`,
      }) as unknown,
    }),
  );
  expect(JSON.stringify(result)).not.toContain(TOKEN);
});

it("keeps log pagination explicit and supports newest-first history", async () => {
  const testWorld = world();
  testWorld.request.mockResolvedValueOnce(
    Response.json({ ...COMPARE, total_commits: 3 }),
  );
  expect(
    await testWorld.service.run("Ed", "repository_log", {
      projectId: "pages",
      range: "c5ee1978..3468b2db",
      limit: 1,
    }),
  ).toMatchObject({ nextPage: 2, total: 3 });
  testWorld.request.mockResolvedValueOnce(Response.json([COMMIT]));
  expect(
    await testWorld.service.run("Ed", "repository_log", {
      projectId: "pages",
      commit: "3468b2db",
      limit: 1,
      page: 2,
    }),
  ).toMatchObject({ order: "newest_first", nextPage: 3 });
  expect(testWorld.request.mock.calls[1]?.[0]).toContain("sha=3468b2db");
});

it("reads diff, show and files at a commit and reports missing patches", async () => {
  const testWorld = world();
  testWorld.request.mockResolvedValueOnce(
    Response.json({ ...COMPARE, files: [{ ...FILE, patch: undefined }] }),
  );
  expect(
    await testWorld.service.run("Ed", "repository_diff", {
      projectId: "pages",
      base: "c5ee1978",
      head: "3468b2db",
    }),
  ).toMatchObject({
    missingPatches: ["docs/report.md"],
    fileLimit: 300,
    filesMayBeTruncated: false,
  });
  testWorld.request.mockResolvedValueOnce(
    Response.json({ ...COMMIT, files: [FILE] }),
  );
  expect(
    await testWorld.service.run("Ed", "repository_show", {
      projectId: "pages",
      commit: "3468b2db",
    }),
  ).toMatchObject({ sha: "3468b2db", files: [FILE] });
  const content = `# File\n${TOKEN}`;
  testWorld.request.mockResolvedValueOnce(
    Response.json({
      type: "file",
      sha: "blob-sha",
      size: content.length,
      content: Buffer.from(content).toString("base64"),
      encoding: "base64",
    }),
  );
  const result = await testWorld.service.run("Ed", "repository_file", {
    projectId: "pages",
    commit: "3468b2db",
    path: "docs/a b.md",
  });
  expect(result).toMatchObject({
    commit: "3468b2db",
    text: "# File\n[REDACTED]",
  });
  expect(testWorld.request.mock.calls[2]?.[0]).toBe(
    "https://api.github.com/repos/owner/pages/contents/docs/a%20b.md?ref=3468b2db",
  );
});

it("authorizes each call before loading the token, including inactive, hidden and revoked accounts", async () => {
  const testWorld = world();
  testWorld.account.mockResolvedValueOnce({ ...ACTOR, isActive: false });
  await expect(
    testWorld.service.run("Ed", "repository_log", { projectId: "pages" }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(testWorld.tokens).not.toHaveBeenCalled();
  testWorld.project.mockRejectedValue(new Error("hidden project"));
  await expect(
    testWorld.service.run("Ed", "repository_log", { projectId: "private" }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(testWorld.tokens).not.toHaveBeenCalled();
  expect(testWorld.request).not.toHaveBeenCalled();
});

it("rejects injected URLs, noncommit refs, traversal and extra credential parameters before credentials are loaded", async () => {
  const testWorld = world();
  for (const input of [
    { projectId: "pages", commit: "main", path: "README.md" },
    { projectId: "pages", commit: "3468b2db", path: "../secret" },
    { projectId: "pages", commit: "3468b2db", path: "/etc/passwd" },
    { projectId: "pages", commit: "3468b2db", path: "README.md", token: TOKEN },
  ])
    await expect(
      testWorld.service.run("Ed", "repository_file", input),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  await expect(
    testWorld.service.run("Ed", "repository_log", {
      projectId: "pages",
      range: "https://evil.invalid",
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  expect(testWorld.tokens).not.toHaveBeenCalled();
});

it("never returns or logs transport error bodies or credentials", async () => {
  const testWorld = world();
  const diagnostic = vi.spyOn(console, "error");
  testWorld.request.mockRejectedValueOnce(
    new Error(`Authorization: Bearer ${TOKEN}`),
  );
  await expect(
    testWorld.service.run("Ed", "repository_log", { projectId: "pages" }),
  ).rejects.toEqual(new RepositoryReadError("PROVIDER_UNAVAILABLE"));
  testWorld.request.mockResolvedValueOnce(new Response(TOKEN, { status: 403 }));
  await expect(
    testWorld.service.run("Ed", "repository_log", { projectId: "pages" }),
  ).rejects.toEqual(new RepositoryReadError("PROVIDER_UNAVAILABLE"));
  expect(diagnostic).not.toHaveBeenCalled();
  testWorld.request.mockResolvedValueOnce(
    Response.json([
      { ...COMMIT, commit: { ...COMMIT.commit, message: TOKEN } },
    ]),
  );
  expect(
    JSON.stringify(
      await testWorld.service.run("Ed", "repository_log", {
        projectId: "pages",
      }),
    ),
  ).not.toContain(TOKEN);
});

it("refuses missing connection, malformed responses and oversized content", async () => {
  const testWorld = world();
  testWorld.tokens.mockResolvedValueOnce(null);
  await expect(
    testWorld.service.run("Ed", "repository_log", { projectId: "pages" }),
  ).rejects.toMatchObject({ code: "NOT_CONNECTED" });
  testWorld.request.mockResolvedValueOnce(Response.json({ unexpected: true }));
  await expect(
    testWorld.service.run("Ed", "repository_log", { projectId: "pages" }),
  ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  testWorld.request.mockResolvedValueOnce(
    new Response("x".repeat(512 * 1024 + 1)),
  );
  await expect(
    testWorld.service.run("Ed", "repository_log", { projectId: "pages" }),
  ).rejects.toMatchObject({ code: "TOO_LARGE" });
  testWorld.request.mockResolvedValueOnce(
    Response.json({
      type: "file",
      sha: "sha",
      size: 128 * 1024 + 1,
      content: "",
      encoding: "base64",
    }),
  );
  await expect(
    testWorld.service.run("Ed", "repository_file", {
      projectId: "pages",
      commit: "3468b2db",
      path: "large.md",
    }),
  ).rejects.toMatchObject({ code: "TOO_LARGE" });
});
