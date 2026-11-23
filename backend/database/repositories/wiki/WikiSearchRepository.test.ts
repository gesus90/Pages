import { expect, it, vi } from "vitest";

import {
  WikiSearchRepository,
  type WikiSearchFilters,
} from "./WikiSearchRepository";

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

const emptyFilters: WikiSearchFilters = {
  terms: [],
  phrases: [],
  titleOnly: false,
  area: null,
  underPageId: null,
  creatorId: null,
  editedFrom: null,
  editedTo: null,
  sort: "relevance",
  limit: 10,
};

const hitRow: DatabaseValue[] = [
  "id",
  "Title",
  "icon",
  "instance",
  null,
  null,
  null,
  "owner",
  "Owner",
  null,
  "u",
  "c",
  "content",
];

function databaseOf(): {
  readonly database: DatabaseTransaction;
  readonly query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async (statement: string) =>
    statement.includes("COUNT(*)") ? [[2n]] : [hitRow],
  );

  return { database: { execute: async () => {}, query }, query };
}

it("searches without any filter", async () => {
  const { database, query } = databaseOf();

  const result = await new WikiSearchRepository(database).search(
    scope,
    emptyFilters,
  );

  expect(result.total).toBe(2);
  expect(result.hits[0]).toMatchObject({ id: "id", content: "content" });
  expect(query.mock.calls[0]?.[0]).toContain("ORDER BY score DESC");
  expect(query.mock.calls[0]?.[0]).toContain("LIMIT 10;");
});

it("matches terms and phrases in titles and texts", async () => {
  const { database, query } = databaseOf();

  await new WikiSearchRepository(database).search(scope, {
    ...emptyFilters,
    terms: ["a_b"],
    phrases: ["two words"],
    sort: "edited",
  });

  expect(query).toHaveBeenCalledWith(
    expect.stringContaining("page.content ILIKE $match_1"),
    expect.objectContaining({
      match_0: "%a\\_b%",
      match_1: "%two words%",
    }),
  );
  expect(query.mock.calls[0]?.[0]).toContain("ORDER BY page.updated_at DESC");
});

it("matches titles only", async () => {
  const { database, query } = databaseOf();

  await new WikiSearchRepository(database).search(scope, {
    ...emptyFilters,
    terms: ["x"],
    titleOnly: true,
    sort: "created",
  });

  expect(query.mock.calls[0]?.[0]).not.toContain("page.content ILIKE");
  expect(query.mock.calls[0]?.[0]).toContain("ORDER BY page.created_at DESC");
});

it("narrows by project area, creator, dates and subtree", async () => {
  const { database, query } = databaseOf();

  await new WikiSearchRepository(database).search(scope, {
    ...emptyFilters,
    area: { scope: "project", projectId: "p" },
    creatorId: "c",
    editedFrom: "2026-01-01",
    editedTo: "2026-02-01",
    underPageId: "root",
  });

  expect(query).toHaveBeenCalledWith(
    expect.stringContaining("WITH RECURSIVE subtree"),
    expect.objectContaining({
      area_scope: "project",
      area_project: "p",
      creator_id: "c",
      edited_from: "2026-01-01",
      edited_to: "2026-02-01 23:59:59.999999",
      under_id: "root",
    }),
  );
});

it("narrows by a scope without a project", async () => {
  const { database, query } = databaseOf();

  await new WikiSearchRepository(database).search(scope, {
    ...emptyFilters,
    area: { scope: "private" },
  });

  const parameters = query.mock.calls[0]?.[1] as Record<string, unknown>;
  expect(parameters.area_scope).toBe("private");
  expect(parameters).not.toHaveProperty("area_project");
});

it("searches titles for the picker with and without a query", async () => {
  const { database, query } = databaseOf();
  const repository = new WikiSearchRepository(database);

  await expect(repository.searchTitles(scope, " x ", 5)).resolves.toEqual([
    { icon: "icon", id: "id", title: "Title" },
  ]);
  await repository.searchTitles(scope, "  ", 5);

  expect(query.mock.calls[0]?.[1]).toHaveProperty("match_0", "%x%");
  expect(query.mock.calls[2]?.[1]).not.toHaveProperty("match_0");
});
