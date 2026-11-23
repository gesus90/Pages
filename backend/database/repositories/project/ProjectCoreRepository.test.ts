import { expect, it, vi, type Mock } from "vitest";

import { ProjectCoreRepository } from "./ProjectCoreRepository";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

function databaseOf(rows: DatabaseValue[][] = []): {
  readonly database: DatabaseTransaction;
  readonly execute: Mock<DatabaseTransaction["execute"]>;
} {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  return { database: { execute, query: async () => rows }, execute };
}

const ROW: DatabaseValue[] = [
  "p1",
  null,
  "Name",
  "Desc",
  "active",
  40,
  "#fff",
  1,
  "u1",
  "Ann",
  "2026-01-01",
  "2026-02-01",
  "notes",
  "c",
  "u",
];

function rowWith(index: number, value: DatabaseValue): DatabaseValue[] {
  return ROW.map((entry, position) => (position === index ? value : entry));
}

it("maps a project row", async () => {
  const { database } = databaseOf([ROW]);
  await expect(new ProjectCoreRepository(database).findAll()).resolves.toEqual([
    {
      departments: [],
      id: "p1",
      parentId: null,
      name: "Name",
      description: "Desc",
      status: "active",
      progress: 40,
      placeholderColor: "#fff",
      hasIcon: true,
      managerId: "u1",
      managerName: "Ann",
      startDate: "2026-01-01",
      targetDate: "2026-02-01",
      notes: "notes",
      createdAt: "c",
      updatedAt: "u",
    },
  ]);
});

it("accepts a project without parent and manager data", async () => {
  const row = ROW.map((entry, index) =>
    index === 1 || (index >= 8 && index <= 11) ? null : entry,
  );
  const { database } = databaseOf([row]);
  await expect(
    new ProjectCoreRepository(database).findByMemberId("u1"),
  ).resolves.toMatchObject([{ managerId: null, startDate: null }]);
});

it.each([
  [1, 5, "parent_id"],
  [8, 5, "manager_id"],
  [9, 5, "manager_name"],
  [10, 5, "start_date"],
  [11, 5, "target_date"],
])("rejects an invalid value at column %i", async (index, value, column) => {
  const { database } = databaseOf([rowWith(index, value)]);
  await expect(new ProjectCoreRepository(database).findAll()).rejects.toThrow(
    `"${column}"`,
  );
});

it("rejects an unsupported status", async () => {
  const { database } = databaseOf([rowWith(4, "weird")]);
  await expect(new ProjectCoreRepository(database).findAll()).rejects.toThrow(
    'unsupported project status "weird"',
  );
});

it.each([1.5, -1, 101])("rejects the progress %s", async (progress) => {
  const { database } = databaseOf([rowWith(5, progress)]);
  await expect(new ProjectCoreRepository(database).findAll()).rejects.toThrow(
    '"progress"',
  );
});

it("lists active ids", async () => {
  const { database } = databaseOf([["a"], ["b"]]);
  await expect(
    new ProjectCoreRepository(database).findActiveIds(),
  ).resolves.toEqual(["a", "b"]);
});

it("reads archived projects with their archive time", async () => {
  const { database } = databaseOf([[...ROW, "2026-03-01"]]);
  const repository = new ProjectCoreRepository(database);
  await expect(repository.findArchived()).resolves.toMatchObject([
    { archivedAt: "2026-03-01" },
  ]);
  await expect(repository.findArchivedById("p1")).resolves.toMatchObject({
    archivedAt: "2026-03-01",
  });
});

it("returns null when no project matches", async () => {
  const { database } = databaseOf();
  const repository = new ProjectCoreRepository(database);
  await expect(repository.findArchivedById("p1")).resolves.toBeNull();
  await expect(repository.findById("p1")).resolves.toBeNull();
});

it("finds a project by id", async () => {
  const { database } = databaseOf([ROW]);
  await expect(
    new ProjectCoreRepository(database).findById("p1"),
  ).resolves.toMatchObject({ id: "p1" });
});

it("inserts the project and its manager membership", async () => {
  const { database, execute } = databaseOf();
  await new ProjectCoreRepository(database).insert({
    id: "p1",
    name: "N",
    description: "D",
    ownerId: "u1",
    placeholderColor: "#fff",
    status: "planned",
  });
  expect(execute.mock.calls[1]?.[1]).toEqual({
    project_id: "p1",
    user_id: "u1",
  });
});

it("updates a project and its details", async () => {
  const { database, execute } = databaseOf();
  const repository = new ProjectCoreRepository(database);
  const base = {
    name: "N",
    description: "D",
    status: "active" as const,
    progress: 3,
  };
  await repository.update("p1", base);
  await repository.updateDetails("p1", {
    ...base,
    managerId: null,
    startDate: null,
    targetDate: "2026-01-01",
    notes: "n",
  });
  expect(execute.mock.calls[0]?.[1]).toMatchObject({ progress: 3 });
  expect(execute.mock.calls[1]?.[1]).toMatchObject({
    manager_id: null,
    notes: "n",
  });
});

it("tells whether archiving changed a row", async () => {
  expect(
    await new ProjectCoreRepository(databaseOf([["p1"]]).database).archive(
      "p1",
    ),
  ).toBe(true);
  expect(
    await new ProjectCoreRepository(databaseOf().database).archive("p1"),
  ).toBe(false);
});
