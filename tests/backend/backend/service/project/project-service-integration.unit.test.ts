import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ServerCache } from "@/backend/cache/ServerCache";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { decryptGitHubToken } from "@/backend/github/GitHubTokenCrypto";
import { ProjectManagementDeniedError } from "@/backend/error/ProjectErrors";
import { hashIntegrationToken } from "@/backend/service/ProjectService";

import { ProjectWorld } from "./project-service-world";

import type { GitHubSyncInterval } from "@/definition/Project";

const TOKEN_KEY = Buffer.alloc(32, 9);
const SECRET = "ghp_synthetic_secret_value";

let world = new ProjectWorld({ tokenKey: TOKEN_KEY });
beforeEach(() => {
  world = new ProjectWorld({ tokenKey: TOKEN_KEY });
});

function form(
  overrides: Partial<
    Parameters<ProjectWorld["service"]["saveIntegration"]>[2]
  > = {},
): Parameters<ProjectWorld["service"]["saveIntegration"]>[2] {
  return {
    repoUrl: " https://github.com/acme/pages.git ",
    token: ` ${SECRET} `,
    syncIssues: true,
    syncStatus: true,
    syncComments: false,
    syncPullRequests: false,
    syncCommits: false,
    syncDirection: "bidirectional",
    syncIntervalMinutes: 15,
    ...overrides,
  };
}

describe("token hashing", () => {
  it("hashes with SHA-256 in hexadecimal", () => {
    expect(hashIntegrationToken("abc")).toBe(
      createHash("sha256").update("abc").digest("hex"),
    );
    expect(hashIntegrationToken("abc")).toHaveLength(64);
  });
});

describe("saving the integration", () => {
  it("stores the repository, a hash and an encrypted token", async () => {
    const saved = await world.service.saveIntegration(
      world.user("lead"),
      "alpha",
      form(),
    );

    const stored = world.state.secrets.get("alpha");
    expect(stored).toMatchObject({
      repoUrl: "https://github.com/acme/pages.git",
      repoName: "acme/pages",
      tokenHash: hashIntegrationToken(SECRET),
      isConnected: false,
      syncIntervalMinutes: 15,
    });
    expect(stored?.tokenEncrypted).not.toContain(SECRET);
    expect(decryptGitHubToken(stored?.tokenEncrypted ?? "", TOKEN_KEY)).toBe(
      SECRET,
    );
    expect(saved).toMatchObject({ hasToken: true, repoName: "acme/pages" });
    expect(JSON.stringify(saved)).not.toContain(SECRET);
  });

  it("records the change and forgets cached integrations", async () => {
    const invalidate = vi.spyOn(world.cache, "invalidateGitHub");

    await world.service.saveIntegration(world.user("lead"), "alpha", form());

    expect(invalidate).toHaveBeenCalled();
    expect(world.state.activity).toMatchObject([
      { action: "integration_saved", category: "integrations" },
    ]);
  });

  it("keeps the stored secret when the token field stays empty", async () => {
    await world.service.saveIntegration(world.user("lead"), "alpha", form());

    const saved = await world.service.saveIntegration(
      world.user("lead"),
      "alpha",
      form({ token: "   " }),
    );

    expect(world.state.secrets.get("alpha")).toMatchObject({
      tokenHash: null,
      tokenEncrypted: null,
    });
    expect(saved?.hasToken).toBe(true);
  });

  it("accepts an empty repository address", async () => {
    const saved = await world.service.saveIntegration(
      world.user("lead"),
      "alpha",
      form({ repoUrl: "  ", token: "" }),
    );

    expect(saved).toMatchObject({ repoUrl: "", repoName: null });
  });

  it.each([
    "http://github.com/acme/pages",
    "https://gitlab.com/acme/pages",
    "https://github.com/acme",
    "https://github.com/acme/pages/issues",
  ])("rejects the repository address %s", async (repoUrl) => {
    await expect(
      world.service.saveIntegration(
        world.user("lead"),
        "alpha",
        form({ repoUrl }),
      ),
    ).rejects.toThrow("Repository address must look like");
    expect(world.writes).toEqual([]);
  });

  it("rejects an unsupported sync interval", async () => {
    await expect(
      world.service.saveIntegration(
        world.user("lead"),
        "alpha",
        form({ syncIntervalMinutes: 7 as GitHubSyncInterval }),
      ),
    ).rejects.toThrow("Sync interval must be 0, 5, 15, 30, or 60 minutes.");
  });

  it("refuses a token while the server has no encryption key", async () => {
    world = new ProjectWorld({ tokenKey: null });

    await expect(
      world.service.saveIntegration(world.user("lead"), "alpha", form()),
    ).rejects.toThrow(
      "GitHub synchronization is not configured on this server.",
    );
    expect(world.writes).toEqual([]);
  });

  it("refuses a reader and keeps the project unchanged", async () => {
    await expect(
      world.service.saveIntegration(world.user("writer"), "alpha", form()),
    ).rejects.toBeInstanceOf(ProjectManagementDeniedError);
    expect(world.state.integrations.size).toBe(0);
  });
});

describe("switching and disconnecting", () => {
  it("does nothing while the project has no integration", async () => {
    await expect(
      world.service.setIntegrationSyncEnabled(
        world.user("lead"),
        "alpha",
        false,
      ),
    ).resolves.toBeNull();
    expect(world.writes).toEqual([]);
  });

  it("switches synchronization off and on while keeping the secret", async () => {
    await world.service.saveIntegration(world.user("lead"), "alpha", form());

    const off = await world.service.setIntegrationSyncEnabled(
      world.user("lead"),
      "alpha",
      false,
    );
    const on = await world.service.setIntegrationSyncEnabled(
      world.user("lead"),
      "alpha",
      true,
    );

    expect(off).toMatchObject({ syncEnabled: false, hasToken: true });
    expect(on).toMatchObject({ syncEnabled: true });
    expect(world.state.activity.map((entry) => entry.message)).toEqual([
      "GitHub integration settings were saved.",
      "GitHub synchronization was switched off.",
      "GitHub synchronization was switched on.",
    ]);
  });

  it("refuses to switch without responsibility", async () => {
    await expect(
      world.service.setIntegrationSyncEnabled(
        world.user("writer"),
        "alpha",
        false,
      ),
    ).rejects.toBeInstanceOf(ProjectManagementDeniedError);
  });

  it("removes the integration with its secrets and records it", async () => {
    await world.service.saveIntegration(world.user("lead"), "alpha", form());

    await world.service.disconnectIntegration(world.user("lead"), "alpha");

    expect(world.state.integrations.size).toBe(0);
    expect(world.state.secrets.size).toBe(0);
    expect(world.state.activity.at(-1)).toMatchObject({
      action: "integration_disconnected",
    });
  });

  it("refuses to disconnect without responsibility", async () => {
    await world.service.saveIntegration(world.user("lead"), "alpha", form());

    await expect(
      world.service.disconnectIntegration(world.user("writer"), "alpha"),
    ).rejects.toBeInstanceOf(ProjectManagementDeniedError);
    expect(world.state.integrations.size).toBe(1);
  });
});

describe("reading integrations", () => {
  it("returns the sanitized integration for a reader", async () => {
    await world.service.saveIntegration(world.user("lead"), "alpha", form());

    const integration = await world.service.findIntegration(
      world.user("writer"),
      "alpha",
    );

    expect(integration).toMatchObject({ projectId: "alpha", hasToken: true });
    expect(JSON.stringify(integration)).not.toContain(SECRET);
  });

  it("serves repeated project-set reads from the cache until a save", async () => {
    world = new ProjectWorld({ tokenKey: TOKEN_KEY, cache: new ServerCache() });
    const read = vi.spyOn(
      ProjectRepository.prototype,
      "findIntegrationsByProjectIds",
    );

    await world.service.findIntegrationsByProjects(["alpha"]);
    await world.service.findIntegrationsByProjects(["alpha"]);
    expect(read).toHaveBeenCalledTimes(1);

    await world.service.saveIntegration(world.user("lead"), "alpha", form());
    const fresh = await world.service.findIntegrationsByProjects(["alpha"]);

    expect(read).toHaveBeenCalledTimes(2);
    expect(fresh.get("alpha")).toMatchObject({ hasToken: true });
  });
});
