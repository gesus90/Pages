import { describe, expect, it, vi } from "vitest";

import { WikiSearchRepository } from "@/backend/database/repositories/wiki/WikiSearchRepository";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { WikiSearchFilters } from "@/backend/database/repositories/wiki/WikiSearchRepository";

const scope = {
  userId: "u",
  isAdmin: false,
  departmentIds: [],
  projectIds: ["p"],
};
const row = [
  "id",
  "Title",
  null,
  "project",
  "p",
  "Project",
  null,
  "u",
  "User",
  null,
  "now",
  "then",
  "body",
];
const filters: WikiSearchFilters = {
  terms: ["100%"],
  phrases: ["a_b"],
  titleOnly: false,
  area: { scope: "project", projectId: "p" },
  underPageId: "parent",
  creatorId: "u",
  editedFrom: "2026-01-01",
  editedTo: "2026-01-02",
  sort: "relevance",
  limit: 10,
};

describe("wiki search persistence", () => {
  it("searches only visible pages with escaped terms and all filters", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([[1]]);
    const repository = new WikiSearchRepository(
      partial<DatabaseTransaction>({ query }),
    );
    await expect(repository.search(scope, filters)).resolves.toMatchObject({
      hits: [{ id: "id", content: "body" }],
      total: 1,
    });
    const parameters: unknown = query.mock.calls[0]?.[1];
    expect(parameters).toMatchObject({
      match_0: "%100\\%%",
      match_1: "%a\\_b%",
      area_scope: "project",
      area_project: "p",
      under_id: "parent",
      creator_id: "u",
      edited_from: "2026-01-01",
      edited_to: "2026-01-02 23:59:59.999999",
    });
  });

  it("trims title queries and permits an empty query", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([[1]])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([[0]]);
    const repository = new WikiSearchRepository(
      partial<DatabaseTransaction>({ query }),
    );
    await expect(
      repository.searchTitles(scope, "  Title  ", 5),
    ).resolves.toEqual([{ id: "id", title: "Title", icon: null }]);
    await expect(repository.searchTitles(scope, "  ", 5)).resolves.toEqual([]);
    expect(query.mock.calls[0]?.[1]).toMatchObject({ match_0: "%Title%" });
  });
});
