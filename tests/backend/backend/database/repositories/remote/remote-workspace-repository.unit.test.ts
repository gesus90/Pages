import { beforeEach, expect, it, vi } from "vitest";

import { RemoteWorkspaceRepository } from "@/backend/database/repositories/remote/RemoteWorkspaceRepository";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { RemoteWorkspaceRecord } from "@/backend/database/repositories/remote/RemoteWorkspaceRepository";

const query = vi.fn();
const execute = vi.fn();
const transaction = partial<DatabaseTransaction>({ query, execute });
const database = partial<Database>({
  transaction: async (work) => work(transaction),
  readTransaction: async (work) => work(transaction),
});
const repository = new RemoteWorkspaceRepository(database);
const row = [
  "id",
  "Workspace",
  "connection",
  "/work",
  "project",
  "user",
  "2026-01-01",
  null,
  2,
  '["/work"]',
];
const workspace: RemoteWorkspaceRecord = {
  id: "id",
  name: "Workspace",
  connectionId: "connection",
  path: "/work",
  projectId: "project",
  registeredBy: "user",
  revision: 2,
  check: { checkedAt: "2026-01-01", issue: null, roots: ["/work"] },
};

beforeEach(() => {
  vi.resetAllMocks();
  query.mockResolvedValue([]);
});

it("reads a profile and its stored directory check", async () => {
  query.mockResolvedValue([row]);
  expect(await repository.list()).toEqual([workspace]);
  expect(await repository.find("id")).toEqual(workspace);
  expect(await repository.find("missing")).toBeNull();
});

it("inserts new profiles after checking for overlapping paths", async () => {
  await repository.save(workspace, true);
  expect(query).toHaveBeenCalledTimes(2);
  expect(execute).toHaveBeenCalledWith(
    expect.stringContaining("INSERT INTO remote_workspaces"),
    expect.objectContaining({
      registered_by: "user",
      check_roots_json: '["/work"]',
    }),
  );
  expect(query.mock.calls[1][1]).toMatchObject({
    path: "/work",
    prefix: "/work/",
  });
});

it("rejects duplicate, missing, stale or overlapping profiles", async () => {
  query.mockResolvedValueOnce([row]);
  await expect(repository.save(workspace, true)).rejects.toThrow();
  query.mockResolvedValueOnce([]);
  await expect(repository.save(workspace, false)).rejects.toThrow();
  query.mockResolvedValueOnce([row]);
  await expect(
    repository.save({ ...workspace, revision: 1 }, false),
  ).rejects.toThrow();
  query.mockResolvedValueOnce([]).mockResolvedValueOnce([["other"]]);
  await expect(repository.save(workspace, true)).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
});

it("updates an unchanged revision and stores a fresh check", async () => {
  query.mockResolvedValueOnce([row]).mockResolvedValueOnce([]);
  await repository.save({ ...workspace, check: null }, false);
  expect(execute).toHaveBeenCalledWith(
    expect.stringContaining("revision = revision + 1"),
    expect.objectContaining({ check_roots_json: null }),
  );
  await repository.saveCheck("id", 2, {
    checkedAt: "later",
    issue: null,
    roots: ["/"],
  });
  expect(execute).toHaveBeenLastCalledWith(
    expect.stringContaining("AND revision = $revision"),
    expect.objectContaining({ revision: 2, check_roots_json: '["/"]' }),
  );
});
