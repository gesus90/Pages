import { expect, it, vi } from "vitest";

import {
  WikiPageWriteRepository,
  type NewWikiPage,
  type WikiPlacement,
} from "./WikiPageWriteRepository";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

function repositoryOf(rows: DatabaseValue[][] = []): {
  readonly repository: WikiPageWriteRepository;
  readonly execute: ReturnType<typeof vi.fn>;
  readonly query: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn(async () => {});
  const query = vi.fn(async () => rows);
  const database: DatabaseTransaction = { execute, query };

  return { repository: new WikiPageWriteRepository(database), execute, query };
}

const placement: WikiPlacement = {
  parentId: "parent",
  scope: "project",
  projectId: "project",
};
const page: NewWikiPage = {
  id: "id",
  parentId: null,
  scope: "instance",
  projectId: null,
  ownerId: "owner",
  authorId: "author",
  title: "Title",
  icon: null,
  content: "text",
  isTemplate: true,
};

it("returns a text without NUL characters unchanged", async () => {
  const { repository, query } = repositoryOf();

  await expect(repository.storedTextForm("text")).resolves.toBe("text");
  expect(query).not.toHaveBeenCalled();
});

it("computes the next position or starts at one", async () => {
  const next = repositoryOf([[4]]);
  const first = repositoryOf();

  await expect(next.repository.nextPosition(placement, "owner")).resolves.toBe(
    4,
  );
  await expect(first.repository.nextPosition(placement, "owner")).resolves.toBe(
    1,
  );
  expect(next.query).toHaveBeenCalledWith(expect.any(String), {
    owner_id: "owner",
    parent_id: "parent",
    project_id: "project",
    scope: "project",
  });
});

it("inserts a page with the template flag", async () => {
  const { repository, execute } = repositoryOf();

  await repository.insert(page, 2);
  await repository.insert({ ...page, isTemplate: false }, 3);

  expect(execute).toHaveBeenNthCalledWith(
    1,
    expect.stringContaining("INSERT INTO wiki_pages"),
    expect.objectContaining({ id: "id", is_template: 1, position: 2 }),
  );
  expect(execute).toHaveBeenNthCalledWith(
    2,
    expect.any(String),
    expect.objectContaining({ is_template: 0, position: 3 }),
  );
});

it("saves an edit with and without an expected revision", async () => {
  const saved = repositoryOf([[5n]]);
  const missing = repositoryOf();
  const edit = { title: "T", content: "C", icon: null, editorId: "e" };

  await expect(saved.repository.saveEdit("id", edit, 4)).resolves.toBe(5);
  await expect(missing.repository.saveEdit("id", edit)).resolves.toBe(0);
  expect(saved.query).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ expected_revision: 4 }),
  );
  expect(missing.query).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ expected_revision: null }),
  );
});

it("places a page and applies the scope to descendants", async () => {
  const { repository, execute } = repositoryOf();

  await repository.place("id", placement, 2, "editor");
  await repository.applyScopeToDescendants("id", placement);

  expect(execute).toHaveBeenNthCalledWith(1, expect.any(String), {
    editor_id: "editor",
    id: "id",
    parent_id: "parent",
    position: 2,
    project_id: "project",
    scope: "project",
  });
  expect(execute).toHaveBeenNthCalledWith(2, expect.any(String), {
    page_id: "id",
    project_id: "project",
    scope: "project",
  });
});

it("writes positions starting at one", async () => {
  const { repository, execute } = repositoryOf();

  await repository.writePositions(["a", "b"]);

  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute).toHaveBeenLastCalledWith(expect.any(String), {
    id: "b",
    position: 2,
  });
});

it("lists the sibling identifiers", async () => {
  await expect(
    repositoryOf([["a"], ["b"]]).repository.findSiblingIds(placement, "owner"),
  ).resolves.toEqual(["a", "b"]);
});

it("sets the validity, cover and owner of a page", async () => {
  const { repository, execute } = repositoryOf();

  await repository.setCurrentUntil("id", "2026-01-01");
  await repository.setCover("id", null);
  await repository.setOwner("id", "owner");

  expect(execute).toHaveBeenNthCalledWith(1, expect.any(String), {
    current_until: "2026-01-01",
    id: "id",
  });
  expect(execute).toHaveBeenNthCalledWith(2, expect.any(String), {
    cover: null,
    id: "id",
  });
  expect(execute).toHaveBeenNthCalledWith(3, expect.any(String), {
    id: "id",
    owner_id: "owner",
  });
});

it("marks a subtree as deleted and brings it back", async () => {
  const { repository, execute } = repositoryOf();

  await repository.markDeleted("id", "user");
  await repository.clearDeleted("id");

  expect(execute).toHaveBeenNthCalledWith(
    1,
    expect.stringContaining("deleted_root_id = $page_id"),
    { page_id: "id", user_id: "user" },
  );
  expect(execute).toHaveBeenNthCalledWith(
    2,
    expect.stringContaining("deleted_at = NULL"),
    { page_id: "id" },
  );
});
