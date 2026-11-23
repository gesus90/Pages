import { expect, it, vi, type Mock } from "vitest";

import {
  ProjectIntegrationRepository,
  type NewProjectIntegration,
} from "./ProjectIntegrationRepository";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

function databaseOf(rows: DatabaseValue[][] = []): {
  readonly database: DatabaseTransaction;
  readonly execute: Mock<DatabaseTransaction["execute"]>;
  readonly query: Mock<DatabaseTransaction["query"]>;
} {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  const query = vi.fn<DatabaseTransaction["query"]>(async () => rows);
  return { database: { execute, query }, execute, query };
}

const ROW: DatabaseValue[] = [
  "p1",
  "https://github.com/o/r",
  1,
  1,
  0,
  1,
  0,
  1,
  "push",
  15,
  1,
  "o/r",
  "2026-01-01",
  "2026-01-02",
  "2026-01-03",
  1,
];

function rowWith(index: number, value: DatabaseValue): DatabaseValue[] {
  return ROW.map((entry, position) => (position === index ? value : entry));
}

const SETTINGS: NewProjectIntegration = {
  repoUrl: "https://github.com/o/r",
  tokenHash: null,
  tokenEncrypted: null,
  syncIssues: true,
  syncStatus: false,
  syncComments: true,
  syncPullRequests: false,
  syncCommits: true,
  syncDirection: "pull",
  syncIntervalMinutes: 5,
  isConnected: true,
  repoName: null,
  lastSyncAt: null,
};

it("maps an integration row", async () => {
  const { database } = databaseOf([ROW]);
  await expect(
    new ProjectIntegrationRepository(database).findByProjectId("p1"),
  ).resolves.toEqual({
    projectId: "p1",
    repoUrl: "https://github.com/o/r",
    hasToken: true,
    syncIssues: true,
    syncStatus: false,
    syncComments: true,
    syncPullRequests: false,
    syncCommits: true,
    syncDirection: "push",
    syncIntervalMinutes: 15,
    isConnected: true,
    repoName: "o/r",
    lastSyncAt: "2026-01-01",
    nextSyncAt: "2026-01-02",
    updatedAt: "2026-01-03",
    syncEnabled: true,
  });
});

it("maps the sync directions and nullable timestamps", async () => {
  const { database } = databaseOf([
    rowWith(8, "pull"),
    [...ROW.slice(0, 8), "other", 0, 0, null, null, null, "u", 0],
  ]);
  const map = await new ProjectIntegrationRepository(database).findByProjectIds(
    ["p1"],
  );
  expect(map.size).toBe(1);
  const only = [...map.values()][0];
  expect(only).toMatchObject({
    syncDirection: "bidirectional",
    repoName: null,
    lastSyncAt: null,
    nextSyncAt: null,
  });
});

it.each([
  [9, 7, "sync_interval_minutes"],
  [9, "5", "sync_interval_minutes"],
  [11, 5, "repo_name"],
  [12, 5, "last_sync_at"],
  [13, 5, "next_sync_at"],
])("rejects an invalid value at column %i", async (index, value, column) => {
  const { database } = databaseOf([rowWith(index, value)]);
  await expect(
    new ProjectIntegrationRepository(database).findByProjectId("p1"),
  ).rejects.toThrow(`"${column}"`);
});

it("returns null without an integration", async () => {
  const { database } = databaseOf();
  await expect(
    new ProjectIntegrationRepository(database).findByProjectId("p1"),
  ).resolves.toBeNull();
});

it("skips the query for an empty project list", async () => {
  const { database, query } = databaseOf();
  const map = await new ProjectIntegrationRepository(database).findByProjectIds(
    [],
  );
  expect(map.size).toBe(0);
  expect(query).not.toHaveBeenCalled();
});

it("binds one placeholder per project id", async () => {
  const { database, query } = databaseOf();
  await new ProjectIntegrationRepository(database).findByProjectIds(["a", "b"]);
  expect(query.mock.calls[0]?.[1]).toEqual({
    integration_project_id_0: "a",
    integration_project_id_1: "b",
  });
});

it("reads the encrypted token only when present", async () => {
  expect(
    await new ProjectIntegrationRepository(
      databaseOf().database,
    ).findTokenEncrypted("p"),
  ).toBeNull();
  expect(
    await new ProjectIntegrationRepository(
      databaseOf([[null]]).database,
    ).findTokenEncrypted("p"),
  ).toBeNull();
  expect(
    await new ProjectIntegrationRepository(
      databaseOf([["secret"]]).database,
    ).findTokenEncrypted("p"),
  ).toBe("secret");
});

it("lists due syncs", async () => {
  const { database, query } = databaseOf([["p1", "u1"]]);
  await expect(
    new ProjectIntegrationRepository(database).findDueSyncs("now"),
  ).resolves.toEqual([{ projectId: "p1", ownerId: "u1" }]);
  expect(query.mock.calls[0]?.[1]).toEqual({ now: "now" });
});

it("runs the schedule and switch updates", async () => {
  const { database, execute } = databaseOf();
  const repository = new ProjectIntegrationRepository(database);
  await repository.updateSyncSchedule("p1", {
    lastSyncAt: "a",
    nextSyncAt: null,
  });
  await repository.markDisconnected("p1", "tok");
  await repository.deferNextSync("p1", "later");
  await repository.setSyncEnabled("p1", true);
  await repository.setSyncEnabled("p1", false);
  await repository.delete("p1");
  expect(execute).toHaveBeenCalledTimes(6);
  expect(execute.mock.calls[0]?.[1]).toEqual({
    project_id: "p1",
    last_sync_at: "a",
    next_sync_at: null,
  });
  expect(execute.mock.calls[3]?.[1]).toMatchObject({ sync_enabled: 1 });
  expect(execute.mock.calls[4]?.[1]).toMatchObject({ sync_enabled: 0 });
});

it("inserts a new integration and flags a stored token", async () => {
  const { database, execute } = databaseOf();
  const repository = new ProjectIntegrationRepository(database);
  await repository.upsert("p1", { ...SETTINGS, tokenHash: "h" });
  await repository.upsert("p1", SETTINGS);
  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    has_token: 1,
    sync_status: 0,
  });
  expect(execute.mock.calls[1]?.[1]).toMatchObject({ has_token: 0 });
});

it("updates an existing integration and clears the token flag only without a token", async () => {
  const withToken = databaseOf([ROW]);
  await new ProjectIntegrationRepository(withToken.database).upsert(
    "p1",
    SETTINGS,
  );
  expect(withToken.execute.mock.calls[0]?.[1]).toMatchObject({
    clear_token: 0,
  });
  const withoutToken = databaseOf([rowWith(2, 0)]);
  await new ProjectIntegrationRepository(withoutToken.database).upsert(
    "p1",
    SETTINGS,
  );
  expect(withoutToken.execute.mock.calls[0]?.[1]).toMatchObject({
    clear_token: 1,
  });
});
