import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { encryptGitHubToken } from "@/backend/github/GitHubTokenCrypto";
import { RepositoryReadError } from "@/definition/RepositoryRead";

import { RepositoryReadService } from "./RepositoryReadService";

import type { GitHubRepositoryReadClient } from "@/backend/github/GitHubRepositoryReadClient";
import type { RepositoryReadDependencies } from "./RepositoryReadService";

function containingFields(fields: object): object {
  return expect.objectContaining(fields) as object;
}

const KEY = Buffer.alloc(32, 3);
const COMMIT = "a".repeat(40);
const OTHER_COMMIT = "b".repeat(40);
const ACTIVE = { id: "user-1", isActive: true, mustChangePassword: false };

function setup(overrides: Partial<Record<string, unknown>> = {}): {
  readonly accounts: Record<string, Mock>;
  readonly createClient: Mock;
  readonly projects: Record<string, Mock>;
  readonly readClient: Record<string, Mock>;
  readonly repository: Record<string, Mock>;
  readonly service: RepositoryReadService;
} {
  const readClient = {
    diff: vi.fn().mockResolvedValue({ tool: "diff" }),
    file: vi.fn().mockResolvedValue({ tool: "file" }),
    log: vi.fn().mockResolvedValue({ tool: "log" }),
    show: vi.fn().mockResolvedValue({ tool: "show" }),
  };
  const createClient = vi.fn(
    () => readClient as unknown as GitHubRepositoryReadClient,
  );
  const accounts = { getById: vi.fn().mockResolvedValue(ACTIVE) };
  const projects = { getById: vi.fn().mockResolvedValue({}) };
  const repository = {
    findIntegration: vi
      .fn()
      .mockResolvedValue({ repoUrl: "https://github.com/owner/repo.git" }),
    findTokenEncrypted: vi
      .fn()
      .mockResolvedValue(encryptGitHubToken("secret", KEY)),
  };
  const dependencies = {
    accounts,
    createClient,
    projects,
    repository,
    tokenKey: KEY,
    ...overrides,
  } as unknown as RepositoryReadDependencies;

  return {
    accounts,
    createClient,
    projects,
    readClient,
    repository,
    service: new RepositoryReadService(dependencies),
  };
}

describe("run input validation", () => {
  it("rejects invalid input before touching any account", async () => {
    const { service, accounts } = setup();

    await expect(
      service.run("user-1", "repository_log", { projectId: "" }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(accounts.getById).not.toHaveBeenCalled();
  });
});

describe("run dispatch", () => {
  it("reads the log with the validated input", async () => {
    const { service, readClient, createClient } = setup();

    await expect(
      service.run("user-1", "repository_log", { projectId: "p" }),
    ).resolves.toEqual({ tool: "log" });
    expect(readClient.log).toHaveBeenCalledWith({
      limit: 30,
      page: 1,
      projectId: "p",
    });
    expect(createClient).toHaveBeenCalledWith("owner/repo", "secret");
  });

  it("reads a diff", async () => {
    const { service, readClient } = setup();

    await expect(
      service.run("user-1", "repository_diff", {
        base: COMMIT,
        head: OTHER_COMMIT,
        projectId: "p",
      }),
    ).resolves.toEqual({ tool: "diff" });
    expect(readClient.diff).toHaveBeenCalledWith(COMMIT, OTHER_COMMIT);
  });

  it("shows a commit page", async () => {
    const { service, readClient } = setup();

    await expect(
      service.run("user-1", "repository_show", {
        commit: COMMIT,
        limit: 10,
        page: 2,
        projectId: "p",
      }),
    ).resolves.toEqual({ tool: "show" });
    expect(readClient.show).toHaveBeenCalledWith(COMMIT, 2, 10);
  });

  it("reads a file", async () => {
    const { service, readClient } = setup();

    await expect(
      service.run("user-1", "repository_file", {
        commit: COMMIT,
        path: "src/index.ts",
        projectId: "p",
      }),
    ).resolves.toEqual({ tool: "file" });
    expect(readClient.file).toHaveBeenCalledWith(COMMIT, "src/index.ts");
  });
});

describe("run authorization", () => {
  const input = { projectId: "p" };

  it.each([
    ["an unknown account", null],
    ["an inactive account", { ...ACTIVE, isActive: false }],
    [
      "an account that must change its password",
      { ...ACTIVE, mustChangePassword: true },
    ],
  ])("forbids %s", async (_, account) => {
    const { service, accounts, repository } = setup();
    accounts.getById.mockResolvedValue(account);

    await expect(
      service.run("user-1", "repository_log", input),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(repository.findTokenEncrypted).not.toHaveBeenCalled();
  });

  it("forbids a project the account cannot open", async () => {
    const { service, projects, repository } = setup();
    projects.getById.mockRejectedValue(new Error("denied"));

    await expect(
      service.run("user-1", "repository_log", input),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(repository.findIntegration).not.toHaveBeenCalled();
  });
});

describe("run connection", () => {
  const input = { projectId: "p" };

  it.each([
    ["no integration", null],
    ["no address", { repoUrl: "" }],
    ["a foreign address", { repoUrl: "https://example.com/owner/repo" }],
  ])("reports %s as not connected", async (_, integration) => {
    const { service, repository } = setup();
    repository.findIntegration.mockResolvedValue(integration);

    await expect(
      service.run("user-1", "repository_log", input),
    ).rejects.toMatchObject({ code: "NOT_CONNECTED" });
    expect(repository.findTokenEncrypted).not.toHaveBeenCalled();
  });

  it("reports a missing token as not connected", async () => {
    const { service, repository } = setup();
    repository.findTokenEncrypted.mockResolvedValue(null);

    await expect(
      service.run("user-1", "repository_log", input),
    ).rejects.toMatchObject({ code: "NOT_CONNECTED" });
  });

  it("reports an undecryptable token as unavailable", async () => {
    const { service, repository } = setup();
    repository.findTokenEncrypted.mockResolvedValue("garbage");

    const rejection = service.run("user-1", "repository_log", input);

    await expect(rejection).rejects.toBeInstanceOf(RepositoryReadError);
    await expect(rejection).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
  });

  it("builds the default read client without a factory", async () => {
    const fetchDouble = vi.fn().mockResolvedValue({ ok: false, body: null });
    vi.stubGlobal("fetch", fetchDouble);
    const { service } = setup({ createClient: undefined });

    await expect(
      service.run("user-1", "repository_log", input),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(fetchDouble).toHaveBeenCalledWith(
      expect.stringContaining("https://api.github.com/repos/owner/repo"),
      expect.objectContaining({
        headers: containingFields({ Authorization: "Bearer secret" }),
      }),
    );
  });
});
