import { expect, it, vi } from "vitest";

import {
  SourceSearchRepository,
  createVisibleSourceQuery,
} from "./SourceSearchRepository";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type { SourceSearchArea } from "./SourceSearchRepository";

const SCOPE = {
  userId: "u1",
  isAdmin: false,
  departmentIds: ["d1"],
  projectIds: ["p1"],
};
const WHOLE: SourceSearchArea = { scope: SCOPE, projectId: null };
const PROJECT: SourceSearchArea = { scope: SCOPE, projectId: "p1" };

function repositoryOf(...answers: DatabaseValue[][][]): {
  repository: SourceSearchRepository;
  query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn();
  for (const answer of answers) query.mockResolvedValueOnce(answer);
  return {
    repository: new SourceSearchRepository({ query } as unknown as Database),
    query,
  };
}

it("builds a visible source query without a project limit", () => {
  const visible = createVisibleSourceQuery(WHOLE);

  expect(visible.sql).toContain("'wiki_page'::TEXT");
  expect(visible.sql).not.toContain("search_project_id");
  expect(visible.parameters).not.toHaveProperty("search_project_id");
});

it("limits the visible source query to one project", () => {
  const visible = createVisibleSourceQuery(PROJECT);

  expect(visible.sql).toContain("visible_page.scope = 'project'");
  expect(visible.sql).toContain("work_items.project_id = $search_project_id");
  expect(visible.parameters).toMatchObject({ search_project_id: "p1" });
});

it("finds no ticket without keys", async () => {
  const { repository, query } = repositoryOf();

  await expect(repository.findTicketsByKey(WHOLE, [])).resolves.toEqual([]);
  expect(query).not.toHaveBeenCalled();
});

it("finds visible tickets by key in the order of the keys", async () => {
  const { repository, query } = repositoryOf([
    ["t2", "B-2"],
    ["t1", "A-1"],
  ]);

  await expect(
    repository.findTicketsByKey(PROJECT, ["a-1", "x-9", "B-2"]),
  ).resolves.toEqual(["t1", "t2"]);
  expect(query.mock.calls[0]?.[1]).toMatchObject({ search_project_id: "p1" });
});

it("finds ticket keys without a project limit", async () => {
  const { repository, query } = repositoryOf([["t1", "A-1"]]);

  await repository.findTicketsByKey(WHOLE, ["A-1"]);

  expect(query.mock.calls[0]?.[0]).not.toContain("search_project_id");
});

it("searches no ticket without needles", async () => {
  const { repository, query } = repositoryOf();

  await expect(repository.searchTickets(WHOLE, [], 5)).resolves.toEqual([]);
  expect(query).not.toHaveBeenCalled();
});

it("searches tickets with escaped patterns and a limit", async () => {
  const { repository, query } = repositoryOf([
    ["t1", 11],
    ["t2", 1],
  ]);

  await expect(
    repository.searchTickets(PROJECT, ["50%", "a_b"], 7.9),
  ).resolves.toEqual(["t1", "t2"]);
  expect(query.mock.calls[0]?.[0]).toContain("LIMIT 7;");
  expect(query.mock.calls[0]?.[1]).toMatchObject({
    ticket_match_0: "%50\\%%",
    ticket_match_1: "%a\\_b%",
    search_project_id: "p1",
  });
});

it("searches tickets across all projects", async () => {
  const { repository, query } = repositoryOf([]);

  await repository.searchTickets(WHOLE, ["x"], 3);

  expect(query.mock.calls[0]?.[1]).not.toHaveProperty("search_project_id");
});

it("reads no source without candidates", async () => {
  const { repository, query } = repositoryOf();

  await expect(
    repository.readCurrentSources(createVisibleSourceQuery(WHOLE), []),
  ).resolves.toEqual({ tickets: [], pages: [], assets: [] });
  expect(query).not.toHaveBeenCalled();
});

it("reads the current state of every kind of candidate", async () => {
  const { repository, query } = repositoryOf(
    [["t1", "K-1", "Title", "Text", "p1"]],
    [["w1", "Page", "Body", 2, null]],
    [["a1", "f.txt", "sum", "K-1", "p1"]],
  );

  const sources = await repository.readCurrentSources(
    createVisibleSourceQuery(WHOLE),
    [
      { sourceType: "ticket", sourceId: "t1" },
      { sourceType: "ticket", sourceId: "t1" },
      { sourceType: "wiki_page", sourceId: "w1" },
      { sourceType: "ticket_asset", sourceId: "a1" },
    ],
  );

  expect(sources).toEqual({
    tickets: [
      {
        id: "t1",
        key: "K-1",
        title: "Title",
        description: "Text",
        projectId: "p1",
      },
    ],
    pages: [
      {
        id: "w1",
        title: "Page",
        content: "Body",
        revision: 2,
        projectId: null,
      },
    ],
    assets: [
      {
        id: "a1",
        fileName: "f.txt",
        checksum: "sum",
        ticketKey: "K-1",
        projectId: "p1",
      },
    ],
  });
  expect(query).toHaveBeenCalledTimes(3);
});
