import path from "node:path";

import { beforeEach, expect, it, vi, type Mock } from "vitest";

import {
  AgentWorkspaceRepository,
  type WorkspaceJournal,
} from "./AgentWorkspaceRepository";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { AgentWorkspace } from "@/definition/AgentWorkspace";

const references = vi.hoisted(() => ({
  usages: vi.fn<(id: string) => Promise<readonly unknown[]>>(),
  detach: vi.fn<(id: string, removal: unknown) => Promise<void>>(),
}));

vi.mock("./AgentWorkspaceReferencesRepository", () => ({
  AgentWorkspaceReferencesRepository: class {
    public usages = references.usages;
    public detach = references.detach;
  },
}));

const WORKSPACE: AgentWorkspace = {
  id: "w1",
  name: "Main",
  path: "/srv/main",
  directoryIdentity: "dev:1",
  projectId: "p1",
  registeredBy: "u1",
  revision: 2,
};

const WORKSPACE_ROW: DatabaseValue[] = [
  "w1",
  "Main",
  "/srv/main",
  "dev:1",
  "p1",
  "u1",
  2,
];

function databaseOf(...answers: DatabaseValue[][][]): {
  readonly database: ConstructorParameters<typeof AgentWorkspaceRepository>[0];
  readonly execute: Mock<DatabaseTransaction["execute"]>;
  readonly query: Mock<DatabaseTransaction["query"]>;
  readonly transaction: DatabaseTransaction;
} {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  const query = vi.fn<DatabaseTransaction["query"]>(async () => []);
  for (const rows of answers) query.mockResolvedValueOnce(rows);
  const transaction: DatabaseTransaction = { execute, query };
  const run = async <Result>(
    work: (inner: DatabaseTransaction) => Promise<Result>,
  ): Promise<Result> => work(transaction);
  return {
    database: { transaction: run, readTransaction: run },
    execute,
    query,
    transaction,
  };
}

beforeEach(() => {
  references.usages.mockReset().mockResolvedValue([]);
  references.detach.mockReset().mockResolvedValue();
});

it("lists registrations", async () => {
  const { database } = databaseOf([WORKSPACE_ROW]);
  await expect(new AgentWorkspaceRepository(database).list()).resolves.toEqual([
    WORKSPACE,
  ]);
});

it("returns the usages of a registration", async () => {
  const usage = { id: "a1", name: "A", kind: "agent" };
  references.usages.mockResolvedValue([usage]);
  const { database } = databaseOf();
  await expect(
    new AgentWorkspaceRepository(database).usages("w1"),
  ).resolves.toEqual([usage]);
  expect(references.usages).toHaveBeenCalledWith("w1");
});

it("saves a new registration at revision one", async () => {
  const { database, execute } = databaseOf([], []);
  const journal = vi.fn<WorkspaceJournal>(async () => {});
  await new AgentWorkspaceRepository(database).save(
    { ...WORKSPACE, revision: 0 },
    true,
    journal,
  );
  expect(execute.mock.calls[0]?.[1]).toEqual({
    id: "w1",
    name: "Main",
    path: "/srv/main",
    identity: "dev:1",
    project_id: "p1",
    registered_by: "u1",
  });
  expect(journal.mock.calls[0]?.[1]).toMatchObject({ revision: 1 });
});

it("saves an unchanged-location update without a journal", async () => {
  const { database, query } = databaseOf([WORKSPACE_ROW], []);
  await new AgentWorkspaceRepository(database).save(
    { ...WORKSPACE, name: "Renamed" },
    false,
  );
  expect(query.mock.calls[1]?.[1]).toEqual({
    id: "w1",
    path: "/srv/main",
    prefix: `/srv/main${path.sep}`,
    separator: path.sep,
  });
  expect(references.usages).not.toHaveBeenCalled();
});

it("journals the next revision of an update", async () => {
  const { database } = databaseOf([WORKSPACE_ROW], []);
  const journal = vi.fn<WorkspaceJournal>(async () => {});
  await new AgentWorkspaceRepository(database).save(WORKSPACE, false, journal);
  expect(journal.mock.calls[0]?.[1]).toMatchObject({ revision: 3 });
});

it("rejects a stale update", async () => {
  const { database } = databaseOf([WORKSPACE_ROW]);
  await expect(
    new AgentWorkspaceRepository(database).save(
      { ...WORKSPACE, revision: 1 },
      false,
    ),
  ).rejects.toMatchObject({ code: "workspace_conflict" });
});

it("rejects an update of a missing registration", async () => {
  const { database } = databaseOf([]);
  await expect(
    new AgentWorkspaceRepository(database).save(WORKSPACE, false),
  ).rejects.toMatchObject({ code: "workspace_conflict" });
});

it("rejects a new registration with an existing identifier", async () => {
  const { database } = databaseOf([WORKSPACE_ROW]);
  await expect(
    new AgentWorkspaceRepository(database).save(WORKSPACE, true),
  ).rejects.toMatchObject({ code: "workspace_conflict" });
});

it("rejects an overlapping directory", async () => {
  const { database } = databaseOf([], [["w2"]]);
  await expect(
    new AgentWorkspaceRepository(database).save(WORKSPACE, true),
  ).rejects.toMatchObject({ code: "workspace_path_conflict" });
});

it("rejects moving a registration that is in use", async () => {
  references.usages.mockResolvedValue([{ id: "r1", name: null, kind: "run" }]);
  const repository = (): AgentWorkspaceRepository =>
    new AgentWorkspaceRepository(databaseOf([WORKSPACE_ROW], []).database);
  for (const change of [
    { path: "/srv/other" },
    { projectId: "p2" },
    { directoryIdentity: "dev:2" },
  ])
    await expect(
      repository().save({ ...WORKSPACE, ...change }, false),
    ).rejects.toMatchObject({ code: "workspace_in_use" });
});

it("allows moving an unreferenced registration", async () => {
  const { database, execute } = databaseOf([WORKSPACE_ROW], []);
  await new AgentWorkspaceRepository(database).save(
    { ...WORKSPACE, path: "/srv/other" },
    false,
  );
  expect(execute).toHaveBeenCalledTimes(1);
});

it("removes an unchanged registration and journals it", async () => {
  const { database, execute } = databaseOf([WORKSPACE_ROW]);
  const journal = vi.fn<WorkspaceJournal>(async () => {});
  await new AgentWorkspaceRepository(database).remove("w1", 2, journal, "u9");
  expect(references.detach).toHaveBeenCalledWith("w1", {
    userId: "u9",
    name: "Main",
  });
  expect(execute.mock.calls[0]?.[1]).toEqual({ id: "w1" });
  expect(journal.mock.calls[0]?.[1]).toEqual(WORKSPACE);
});

it("attributes the removal to the registrant by default", async () => {
  const { database } = databaseOf([WORKSPACE_ROW]);
  await new AgentWorkspaceRepository(database).remove("w1", 2);
  expect(references.detach).toHaveBeenCalledWith("w1", {
    userId: "u1",
    name: "Main",
  });
});

it("rejects removing a missing or changed registration", async () => {
  await expect(
    new AgentWorkspaceRepository(databaseOf([]).database).remove("w1", 2),
  ).rejects.toMatchObject({ code: "workspace_not_found" });
  await expect(
    new AgentWorkspaceRepository(databaseOf([WORKSPACE_ROW]).database).remove(
      "w1",
      1,
    ),
  ).rejects.toMatchObject({ code: "workspace_conflict" });
});
