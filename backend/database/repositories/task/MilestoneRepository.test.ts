import { expect, it, vi } from "vitest";

import { MilestoneRepository } from "./MilestoneRepository";

import type { DatabaseValue } from "@/backend/database/Database";
import type { TaskDatabase } from "./TaskDatabase";

function repositoryOf(rows: DatabaseValue[][] = []): {
  readonly repository: MilestoneRepository;
  readonly query: ReturnType<typeof vi.fn<TaskDatabase["query"]>>;
  readonly execute: ReturnType<typeof vi.fn<TaskDatabase["execute"]>>;
} {
  const query = vi.fn<TaskDatabase["query"]>(async () => rows);
  const execute = vi.fn<TaskDatabase["execute"]>(async () => {});
  const database: TaskDatabase = {
    query,
    execute,
    transaction: async (work) => work({ query, execute }),
    readTransaction: async (work) => work({ query, execute }),
  };
  return { repository: new MilestoneRepository(database), query, execute };
}

const FULL_ROW: DatabaseValue[] = [
  "m1",
  "p1",
  "Name",
  "Desc",
  "completed",
  "2026-01-01",
  "2026-02-01",
  "c",
  "u",
  "2026-03-01",
  "2026-04-01",
  "release",
  "rocket",
  "#aabbcc",
];
const PLAIN_ROW: DatabaseValue[] = [
  "m2",
  "p1",
  "Plain",
  "",
  "weird",
  null,
  null,
  "c",
  "u",
  null,
  null,
  "nope",
  "nope",
  "red",
];

it("returns no milestones without querying for no projects", async () => {
  const { repository, query } = repositoryOf();

  await expect(repository.findByProjectIds([])).resolves.toEqual([]);
  expect(query).not.toHaveBeenCalled();
});

it("maps valid and invalid optional values of milestone rows", async () => {
  const { repository } = repositoryOf([
    FULL_ROW,
    PLAIN_ROW,
    [...PLAIN_ROW.slice(0, 13), null],
  ]);

  const [full, plain, noColor] = await repository.findByProjectIds(["p1"]);

  expect(full).toMatchObject({
    colorCustom: "#aabbcc",
    colorKey: "release",
    iconKey: "rocket",
    status: "completed",
    archivedAt: "2026-04-01",
  });
  expect(plain).toMatchObject({
    colorCustom: null,
    colorKey: null,
    iconKey: null,
    status: "open",
    startAt: null,
  });
  expect(noColor?.colorCustom).toBeNull();
});

it("finds a milestone by id, optionally including archived ones", async () => {
  const found = repositoryOf([FULL_ROW]);
  await expect(found.repository.findById("m1")).resolves.toMatchObject({
    id: "m1",
  });
  expect(found.query).toHaveBeenCalledWith(expect.any(String), {
    id: "m1",
    include_archived: false,
  });

  await found.repository.findById("m1", { includeArchived: true });
  expect(found.query).toHaveBeenLastCalledWith(expect.any(String), {
    id: "m1",
    include_archived: true,
  });

  await expect(repositoryOf().repository.findById("x")).resolves.toBeNull();
});

it("inserts a milestone with defaults for omitted optional values", async () => {
  const { repository, execute } = repositoryOf();

  await repository.insert({
    id: "m1",
    projectId: "p1",
    name: "N",
    description: "D",
    dueAt: null,
  });
  await repository.insert({
    id: "m2",
    projectId: "p1",
    name: "N",
    description: "D",
    dueAt: "d",
    startAt: "s",
    colorKey: "team",
    iconKey: "flag",
    colorCustom: "#000000",
  });

  expect(execute).toHaveBeenNthCalledWith(1, expect.any(String), {
    id: "m1",
    project_id: "p1",
    name: "N",
    description: "D",
    start_at: null,
    due_at: null,
    color_key: null,
    icon_key: null,
    color_custom: null,
  });
  expect(execute).toHaveBeenNthCalledWith(
    2,
    expect.any(String),
    expect.objectContaining({
      start_at: "s",
      color_key: "team",
      icon_key: "flag",
      color_custom: "#000000",
    }),
  );
});

it("updates a milestone with defaults for omitted optional values", async () => {
  const { repository, execute } = repositoryOf();

  await repository.update("m1", {
    name: "N",
    description: "D",
    status: "open",
    dueAt: null,
  });
  await repository.update("m1", {
    name: "N",
    description: "D",
    status: "completed",
    dueAt: "d",
    startAt: "s",
    colorKey: "team",
    iconKey: "flag",
    colorCustom: "#000000",
  });

  expect(execute).toHaveBeenNthCalledWith(
    1,
    expect.any(String),
    expect.objectContaining({
      start_at: null,
      color_key: null,
      icon_key: null,
      color_custom: null,
    }),
  );
  expect(execute).toHaveBeenNthCalledWith(
    2,
    expect.any(String),
    expect.objectContaining({
      status: "completed",
      start_at: "s",
    }),
  );
});

it("replaces one field with its fixed statement and reports whether a row changed", async () => {
  const fields = ["name", "description", "status", "startAt", "dueAt"] as const;
  const statements = new Set<string>();
  for (const field of fields) {
    const { repository, query } = repositoryOf([["m1"]]);
    await expect(
      repository.updateField("m1", { field, base: "a", value: "b" }),
    ).resolves.toBe(true);
    statements.add(String(query.mock.calls[0]?.[0]));
    expect(query).toHaveBeenCalledWith(expect.any(String), {
      base_value: "a",
      id: "m1",
      value: "b",
    });
  }
  expect(statements.size).toBe(5);
  await expect(
    repositoryOf().repository.updateField("m1", {
      field: "name",
      base: null,
      value: null,
    }),
  ).resolves.toBe(false);
});

it("archives a milestone", async () => {
  const { repository, execute } = repositoryOf();

  await repository.archive("m1");

  expect(execute).toHaveBeenCalledWith(expect.any(String), { id: "m1" });
});
