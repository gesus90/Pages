import { describe, expect, it } from "vitest";

import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { encryptGitHubToken } from "@/backend/github/GitHubTokenCrypto";

import { useMigratedDatabase } from "../helpers/test-database";

const TOKEN_KEY = Buffer.alloc(32, 7);
const DUE = "2026-10-07T12:00:00.000Z";

describe("project-wide GitHub sync switch", () => {
  const getDatabase = useMigratedDatabase();

  async function setup() {
    const database = getDatabase();

    await database.execute(
      "INSERT INTO projects (id, name, owner_id) VALUES ('p1', 'Pages', 'owner');",
    );

    const repository = new ProjectRepository(database);

    await repository.upsertIntegration("p1", {
      isConnected: true,
      lastSyncAt: null,
      repoName: "example/repo",
      repoUrl: "https://github.com/example/repo",
      syncComments: false,
      syncCommits: false,
      syncDirection: "bidirectional",
      syncIntervalMinutes: 5,
      syncIssues: true,
      syncPullRequests: true,
      syncStatus: true,
      tokenEncrypted: encryptGitHubToken("fixture-token", TOKEN_KEY),
      tokenHash: "fixture",
    });

    return repository;
  }

  it("keeps new and existing connections switched on", async () => {
    const repository = await setup();

    await expect(repository.findIntegration("p1")).resolves.toMatchObject({
      syncEnabled: true,
    });
    await expect(repository.findDueSyncIntegrations(DUE)).resolves.toEqual([
      { ownerId: "owner", projectId: "p1" },
    ]);
  });

  it("leaves a switched-off project out of the scheduled runs and keeps its token", async () => {
    const repository = await setup();

    await repository.setIntegrationSyncEnabled("p1", false);

    await expect(repository.findIntegration("p1")).resolves.toMatchObject({
      hasToken: true,
      repoName: "example/repo",
      syncEnabled: false,
    });
    await expect(repository.findTokenEncrypted("p1")).resolves.not.toBeNull();
    await expect(repository.findDueSyncIntegrations(DUE)).resolves.toEqual([]);

    await repository.setIntegrationSyncEnabled("p1", true);

    await expect(repository.findDueSyncIntegrations(DUE)).resolves.toHaveLength(
      1,
    );
  });

  it("keeps the switch when the connection settings are saved again", async () => {
    const repository = await setup();

    await repository.setIntegrationSyncEnabled("p1", false);
    await repository.upsertIntegration("p1", {
      isConnected: false,
      lastSyncAt: null,
      repoName: "example/other",
      repoUrl: "https://github.com/example/other",
      syncComments: false,
      syncCommits: false,
      syncDirection: "bidirectional",
      syncIntervalMinutes: 15,
      syncIssues: true,
      syncPullRequests: true,
      syncStatus: true,
      tokenEncrypted: null,
      tokenHash: null,
    });

    await expect(repository.findIntegration("p1")).resolves.toMatchObject({
      repoName: "example/other",
      syncEnabled: false,
    });
  });
});
