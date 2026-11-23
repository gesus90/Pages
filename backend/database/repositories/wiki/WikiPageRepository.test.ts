import { expect, it, vi } from "vitest";

import { WikiPageRepository } from "./WikiPageRepository";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { WikiVisibilityScope } from "@/definition/Wiki";

const scope: WikiVisibilityScope = {
  userId: "viewer",
  isAdmin: false,
  projectIds: [],
  departmentIds: [],
};

function repositoryOf(rows: DatabaseValue[][] = []): {
  readonly repository: WikiPageRepository;
  readonly query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  const database: DatabaseTransaction = { execute: async () => {}, query };

  return { repository: new WikiPageRepository(database), query };
}

const summaryRow: DatabaseValue[] = [
  "id",
  "Title",
  null,
  "instance",
  null,
  null,
  null,
  "owner",
  "Owner",
  null,
  "u",
  "c",
];
const pageRow: DatabaseValue[] = [...summaryRow, "body", 1, 0, null, null];
const linkRow: DatabaseValue[] = ["id", "Title", "icon"];

it("finds a visible page or null", async () => {
  const found = repositoryOf([pageRow]);
  const missing = repositoryOf();

  await expect(
    found.repository.findVisible(scope, "id", { includeDeleted: true }),
  ).resolves.toMatchObject({ id: "id", content: "body" });
  await expect(missing.repository.findVisible(scope, "id")).resolves.toBeNull();
  expect(found.query).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ page_id: "id" }),
  );
});

it("lists navigation nodes", async () => {
  const { repository } = repositoryOf([
    ["id", null, "Title", "icon", "instance", null, 2n, "2026-01-01"],
  ]);

  await expect(repository.listNodes(scope)).resolves.toEqual([
    {
      id: "id",
      parentId: null,
      title: "Title",
      icon: "icon",
      scope: "instance",
      projectId: null,
      position: 2,
      currentUntil: "2026-01-01",
    },
  ]);
});

it("lists summaries and templates", async () => {
  const { repository } = repositoryOf([pageRow]);

  await expect(repository.listSummaries(scope)).resolves.toHaveLength(1);
  await expect(repository.listTemplates(scope)).resolves.toHaveLength(1);
});

it("reads titles and children", async () => {
  const titles = repositoryOf([["id", "Title"]]);
  const links = repositoryOf([linkRow]);

  await expect(titles.repository.findTitles(scope, ["id"])).resolves.toEqual([
    { id: "id", title: "Title" },
  ]);
  await expect(links.repository.listChildren(scope, "p")).resolves.toEqual([
    { id: "id", title: "Title", icon: "icon" },
  ]);
  await expect(
    links.repository.listProjectChildren(scope, "project", null),
  ).resolves.toHaveLength(1);
  expect(links.query).toHaveBeenLastCalledWith(
    expect.any(String),
    expect.objectContaining({ project_id: "project", parent_id: null }),
  );
});

it("reads the breadcrumb and counts the levels above", async () => {
  const { repository } = repositoryOf([linkRow, linkRow]);

  await expect(repository.findBreadcrumb("id")).resolves.toHaveLength(2);
  await expect(repository.countLevelsAbove("id")).resolves.toBe(2);
});

it("finds a node record or null", async () => {
  const found = repositoryOf([
    ["id", "parent", "project", "project-id", "owner", 3, null, null, 1],
  ]);

  await expect(found.repository.findNode("id")).resolves.toEqual({
    id: "id",
    parentId: "parent",
    scope: "project",
    projectId: "project-id",
    ownerId: "owner",
    revision: 3,
    deletedAt: null,
    deletedRootId: null,
    isTemplate: true,
  });
  await expect(repositoryOf().repository.findNode("id")).resolves.toBeNull();
});

it("counts the levels below a page", async () => {
  await expect(
    repositoryOf([[3]]).repository.countLevelsBelow("id"),
  ).resolves.toBe(3);
  await expect(repositoryOf().repository.countLevelsBelow("id")).resolves.toBe(
    0,
  );
});

it("lists the subtree identifiers", async () => {
  await expect(
    repositoryOf([["a"], ["b"]]).repository.findSubtreeIds("a"),
  ).resolves.toEqual(["a", "b"]);
});

it("lists the trash", async () => {
  const { repository, query } = repositoryOf([
    [
      "id",
      "Title",
      null,
      "project",
      "Project",
      "owner",
      null,
      "deleted",
      null,
      null,
      "project-id",
    ],
  ]);

  await expect(repository.listTrash(scope, true)).resolves.toEqual([
    {
      id: "id",
      title: "Title",
      icon: null,
      scope: "project",
      projectName: "Project",
      ownerId: "owner",
      ownerName: "",
      deletedAt: "deleted",
      deletedByName: null,
      parentTitle: null,
      projectId: "project-id",
    },
  ]);
  expect(query).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ owned_only: true }),
  );
});

it("lists a deletion group", async () => {
  await expect(
    repositoryOf([linkRow]).repository.listDeletionGroup(scope, "root"),
  ).resolves.toHaveLength(1);
});

it("finds expired trash roots", async () => {
  const { repository, query } = repositoryOf([["a"]]);

  await expect(repository.findExpiredTrashRoots(30)).resolves.toEqual(["a"]);
  expect(query).toHaveBeenCalledWith(expect.any(String), {
    retention_days: 30,
  });
});

it("counts private pages by owner and lists private identifiers", async () => {
  const { repository } = repositoryOf([["owner", 2]]);

  await expect(repository.countPrivateByOwner()).resolves.toEqual(
    new Map([["owner", 2]]),
  );
  await expect(repository.findPrivateIds("owner")).resolves.toEqual(["owner"]);
});
