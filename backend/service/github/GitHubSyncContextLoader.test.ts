import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { WorkItemValidationError } from "@/backend/error/WorkItemErrors";
import { encryptGitHubToken } from "@/backend/github/GitHubTokenCrypto";

import {
  GitHubSyncContextLoader,
  parseGitHubRepository,
} from "./GitHubSyncContextLoader";

import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import type { GitHubApiClient } from "@/backend/github/GitHubApiClient";
import type { ProjectIntegration } from "@/definition/Project";

const KEY = Buffer.alloc(32, 7);
const CLIENT = { name: "client" } as unknown as GitHubApiClient;

function integration(
  overrides: Partial<ProjectIntegration> = {},
): ProjectIntegration {
  return {
    repoUrl: "https://github.com/owner/repo",
    syncEnabled: true,
    ...overrides,
  } as unknown as ProjectIntegration;
}

function setup(
  stored: ProjectIntegration | null,
  encrypted: string | null = null,
): {
  readonly loader: GitHubSyncContextLoader;
  readonly createClient: Mock;
} {
  const createClient = vi.fn(() => CLIENT);
  const loader = new GitHubSyncContextLoader(
    {
      findIntegration: vi.fn().mockResolvedValue(stored),
      findTokenEncrypted: vi.fn().mockResolvedValue(encrypted),
    } as unknown as ProjectRepository,
    createClient,
    KEY,
  );

  return { loader, createClient };
}

describe("parseGitHubRepository", () => {
  it.each([
    ["https://github.com/owner/repo", "repo"],
    ["  https://github.com/owner/repo.git ", "repo"],
    ["https://github.com/owner/repo/", "repo"],
    ["https://github.com/owner/repo.git/", "repo"],
  ])("splits %s", (address, repo) => {
    expect(parseGitHubRepository(address)).toEqual({ owner: "owner", repo });
  });

  it.each(["", "https://example.com/owner/repo", "https://github.com/owner"])(
    "rejects %j",
    (address) => {
      expect(parseGitHubRepository(address)).toBeNull();
    },
  );
});

describe("findContext", () => {
  it("returns null without an integration or address", async () => {
    await expect(setup(null).loader.findContext("p")).resolves.toBeNull();
    await expect(
      setup(integration({ repoUrl: "" })).loader.findContext("p"),
    ).resolves.toBeNull();
  });

  it("returns null when the sync is off unless disabled ones are included", async () => {
    const stored = integration({ syncEnabled: false });
    const encrypted = encryptGitHubToken("secret", KEY);

    await expect(
      setup(stored, encrypted).loader.findContext("p"),
    ).resolves.toBeNull();
    await expect(
      setup(stored, encrypted).loader.findContext("p", {
        includeDisabled: true,
      }),
    ).resolves.toMatchObject({ repo: { owner: "owner", repo: "repo" } });
  });

  it("returns null for an invalid address", async () => {
    await expect(
      setup(
        integration({ repoUrl: "https://example.com/x/y" }),
      ).loader.findContext("p"),
    ).resolves.toBeNull();
  });

  it("returns null without a token unless tokenless is allowed", async () => {
    const stored = integration();
    const strict = setup(stored);
    const lenient = setup(stored);

    await expect(strict.loader.findContext("p")).resolves.toBeNull();
    expect(strict.createClient).not.toHaveBeenCalled();

    await expect(
      lenient.loader.findContext("p", { allowTokenless: true }),
    ).resolves.toEqual({
      client: CLIENT,
      integration: stored,
      repo: { owner: "owner", repo: "repo" },
    });
    expect(lenient.createClient).toHaveBeenCalledWith("");
  });

  it("builds the client with the decrypted token", async () => {
    const stored = integration();
    const { loader, createClient } = setup(
      stored,
      encryptGitHubToken("secret", KEY),
    );

    await expect(loader.findContext("p")).resolves.toEqual({
      client: CLIENT,
      integration: stored,
      repo: { owner: "owner", repo: "repo" },
    });
    expect(createClient).toHaveBeenCalledWith("secret");
  });
});

describe("requireContext", () => {
  it("returns a resolvable context", async () => {
    const { loader } = setup(integration(), encryptGitHubToken("t", KEY));

    await expect(loader.requireContext("p")).resolves.toMatchObject({
      repo: { owner: "owner" },
    });
  });

  it("reports a switched-off synchronization", async () => {
    const { loader } = setup(
      integration({ syncEnabled: false }),
      encryptGitHubToken("t", KEY),
    );

    await expect(loader.requireContext("p")).rejects.toMatchObject({
      code: "githubSyncSwitchedOff",
    });
  });

  it("reports a project that is not connected", async () => {
    const { loader } = setup(null);
    const rejection = loader.requireContext("p");

    await expect(rejection).rejects.toBeInstanceOf(WorkItemValidationError);
    await expect(rejection).rejects.toMatchObject({
      code: "githubNotConnected",
    });
  });
});
