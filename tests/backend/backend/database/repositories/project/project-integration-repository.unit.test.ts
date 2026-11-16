import { beforeEach, expect, it, vi } from "vitest";

import { ProjectIntegrationRepository } from "@/backend/database/repositories/project/ProjectIntegrationRepository";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { NewProjectIntegration } from "@/backend/database/repositories/project/ProjectIntegrationRepository";

const query = vi.fn();
const execute = vi.fn();
const repository = new ProjectIntegrationRepository(
  partial<DatabaseTransaction>({ query, execute }),
);
const row = [
  "project",
  "https://example.com/repo",
  1,
  1,
  0,
  1,
  0,
  1,
  "push",
  15,
  1,
  "repo",
  null,
  null,
  "now",
  1,
];
const integration: NewProjectIntegration = {
  repoUrl: "https://example.com/repo",
  tokenHash: null,
  tokenEncrypted: null,
  syncIssues: true,
  syncStatus: false,
  syncComments: true,
  syncPullRequests: false,
  syncCommits: true,
  syncDirection: "push",
  syncIntervalMinutes: 15,
  isConnected: true,
  repoName: "repo",
  lastSyncAt: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  query.mockResolvedValue([]);
});

it("reads sanitized settings and binds multiple project identifiers", async () => {
  query.mockResolvedValue([row]);
  expect(await repository.findByProjectId("project")).toMatchObject({
    projectId: "project",
    hasToken: true,
    syncDirection: "push",
    syncIntervalMinutes: 15,
  });
  const result = await repository.findByProjectIds(["project"]);
  expect(result.get("project")?.repoName).toBe("repo");
  expect(query).toHaveBeenLastCalledWith(
    expect.stringContaining("$integration_project_id_0"),
    { integration_project_id_0: "project" },
  );
  query.mockClear();
  expect((await repository.findByProjectIds([])).size).toBe(0);
  expect(query).not.toHaveBeenCalled();
});

it("rejects corrupted stored values instead of inventing settings", async () => {
  for (const index of [9, 11, 12, 13]) {
    const broken = [...row];
    broken[index] = index === 9 ? 999 : 42;
    query.mockResolvedValueOnce([broken]);
    await expect(repository.findByProjectId("project")).rejects.toThrow();
  }
});

it("inserts new settings and retains existing token when updating", async () => {
  query.mockResolvedValueOnce([]).mockResolvedValueOnce([row]);
  await repository.upsert("project", integration);
  expect(execute).toHaveBeenLastCalledWith(
    expect.stringContaining("INSERT INTO project_integrations"),
    expect.objectContaining({ has_token: 0, sync_issues: 1 }),
  );
  await repository.upsert("project", integration);
  expect(execute).toHaveBeenLastCalledWith(
    expect.stringContaining("COALESCE($token_hash, token_hash)"),
    expect.objectContaining({ clear_token: 0 }),
  );
});

it("keeps token invalidation tied to the rejected encrypted value", async () => {
  await repository.markDisconnected("project", "old-token");
  expect(execute).toHaveBeenCalledWith(
    expect.stringContaining("AND token_encrypted = $token_encrypted"),
    { project_id: "project", token_encrypted: "old-token" },
  );
  await repository.setSyncEnabled("project", false);
  expect(execute).toHaveBeenLastCalledWith(expect.any(String), {
    project_id: "project",
    sync_enabled: 0,
  });
});
