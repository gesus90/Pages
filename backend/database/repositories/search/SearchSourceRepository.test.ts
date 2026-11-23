import { expect, it, vi } from "vitest";

import {
  SearchSourceRepository,
  ticketSearchText,
  wikiPageSearchText,
} from "./SearchSourceRepository";

import type { Database, DatabaseValue } from "@/backend/database/Database";

function repositoryOf(...answers: DatabaseValue[][][]): {
  repository: SearchSourceRepository;
  query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn();
  for (const answer of answers) query.mockResolvedValueOnce(answer);
  return {
    repository: new SearchSourceRepository({ query } as unknown as Database),
    query,
  };
}

it("builds the text of a ticket and of a wiki page", () => {
  expect(
    ticketSearchText({ id: "i", key: "K-1", title: "T", description: "D" }),
  ).toBe("K-1: T\n\nD");
  expect(
    wikiPageSearchText({ id: "i", title: "T", content: "C", revision: 1 }),
  ).toBe("T\n\nC");
});

it("lists the states of tickets, pages and assets in this order", async () => {
  const { repository } = repositoryOf(
    [["t1", "h1"]],
    [["p1", "h2"]],
    [["a1", "h3"]],
  );

  await expect(repository.listSourceStates()).resolves.toEqual([
    { sourceType: "ticket", sourceId: "t1", contentHash: "h1" },
    { sourceType: "wiki_page", sourceId: "p1", contentHash: "h2" },
    { sourceType: "ticket_asset", sourceId: "a1", contentHash: "h3" },
  ]);
});

it("reads a ticket or null", async () => {
  const found = repositoryOf([["t1", "K-1", "Title", "Text"]]);
  const missing = repositoryOf([]);

  await expect(found.repository.readTicket("t1")).resolves.toEqual({
    id: "t1",
    key: "K-1",
    title: "Title",
    description: "Text",
  });
  expect(found.query.mock.calls[0]?.[1]).toEqual({ id: "t1" });
  await expect(missing.repository.readTicket("t2")).resolves.toBeNull();
});

it("reads a wiki page or null", async () => {
  const found = repositoryOf([["p1", "Title", "Body", 3]]);
  const missing = repositoryOf([]);

  await expect(found.repository.readWikiPage("p1")).resolves.toEqual({
    id: "p1",
    title: "Title",
    content: "Body",
    revision: 3,
  });
  await expect(missing.repository.readWikiPage("p2")).resolves.toBeNull();
});

it("reads a released asset or null", async () => {
  const found = repositoryOf([["a1", "f.png", "image/png", "sum"]]);
  const missing = repositoryOf([]);

  await expect(found.repository.readReleasedAsset("a1")).resolves.toEqual({
    id: "a1",
    fileName: "f.png",
    contentType: "image/png",
    checksum: "sum",
  });
  await expect(missing.repository.readReleasedAsset("a2")).resolves.toBeNull();
});
