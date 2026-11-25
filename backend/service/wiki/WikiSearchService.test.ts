import { expect, it, vi } from "vitest";

import { WikiSearchService } from "./WikiSearchService";

import type { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import type { User } from "@/definition/User";
import type { WikiSearchInput } from "./WikiSearchService";
import type { WikiAccess } from "./WikiAccess";

const actor = { id: "u1" } as unknown as User;
const scope = { userId: "u1" };
const access = {
  resolve: vi.fn(async () => ({ scope })),
} as unknown as WikiAccess;
const emptyInput: WikiSearchInput = {
  creatorId: null,
  editedFrom: null,
  editedTo: null,
  location: null,
  sort: null,
  text: "",
  titleOnly: false,
  underPageId: null,
};

function searchOf(): {
  readonly service: WikiSearchService;
  readonly search: ReturnType<typeof vi.fn>;
} {
  const search = vi.fn(async () => ({
    hits: [{ content: "Hello **world**", id: "p", title: "T" }],
    total: 1,
  }));
  const repository = { search: { search } } as unknown as WikiRepository;

  return { search, service: new WikiSearchService(repository, access) };
}

it("searches nothing without words and filters", async () => {
  const { search, service } = searchOf();

  await expect(service.search(actor, emptyInput)).resolves.toEqual({
    results: [],
    total: 0,
  });
  expect(search).not.toHaveBeenCalled();
});

it("searches with words and cuts a snippet", async () => {
  const { search, service } = searchOf();
  const response = await service.search(actor, {
    ...emptyInput,
    text: "world",
  });

  expect(response).toEqual({
    results: [{ id: "p", snippet: "Hello world", title: "T" }],
    total: 1,
  });
  expect(search).toHaveBeenCalledWith(
    scope,
    expect.objectContaining({ limit: 30, sort: "relevance", terms: ["world"] }),
  );
});

it.each([
  ["instance", { scope: "instance" }],
  ["private", { scope: "private" }],
  ["project:x", { projectId: "x", scope: "project" }],
  ["other", null],
])("parses the location %s", async (location, area) => {
  const { search, service } = searchOf();

  await service.search(actor, { ...emptyInput, location, text: "a" });

  expect(search).toHaveBeenCalledWith(scope, expect.objectContaining({ area }));
});

it.each([
  { creatorId: "c" },
  { editedFrom: "2026-01-01" },
  { editedTo: "2026-01-02" },
  { underPageId: "u" },
])("searches with only the filter %o", async (filter) => {
  const { search, service } = searchOf();

  await service.search(actor, { ...emptyInput, ...filter, sort: "edited" }, 5);

  expect(search).toHaveBeenCalledWith(
    scope,
    expect.objectContaining({ limit: 5, sort: "edited" }),
  );
});

it("offers references of each kind", async () => {
  const repository = {
    links: { searchTickets: vi.fn(async () => [{ key: "A-1" }]) },
    lookups: { searchUsers: vi.fn(async () => [{ id: "u" }]) },
    search: { searchTitles: vi.fn(async () => [{ id: "p" }]) },
  } as unknown as WikiRepository;

  await expect(
    new WikiSearchService(repository, access).references(actor, "q"),
  ).resolves.toEqual([
    { id: "p", kind: "page" },
    { key: "A-1", kind: "ticket" },
    { id: "u", kind: "person" },
  ]);
});

it("resolves link titles and ticket summaries", async () => {
  const repository = {
    links: { findTicketSummaries: vi.fn(async () => [{ key: "A-1" }]) },
    pages: { findTitles: vi.fn(async () => [{ id: "p", title: "T" }]) },
  } as unknown as WikiRepository;
  const service = new WikiSearchService(repository, access);

  await expect(service.linkTitles(actor, ["p"])).resolves.toEqual({ p: "T" });
  await expect(service.ticketSummaries(actor, ["A-1"])).resolves.toEqual([
    { key: "A-1" },
  ]);
});

it("finds the backlinks that really mention the page", async () => {
  const repository = {
    links: {
      findLinkingPages: vi.fn(async () => [
        { extra: 1, icon: null, id: "l", title: "L" },
      ]),
      findProjectsMentioning: vi.fn(async () => [
        { description: "see /wiki/p", id: "pr", name: "P" },
        { description: "see /wiki/pp", id: "px", name: "X" },
      ]),
      findTicketsMentioning: vi.fn(async () => [
        { description: "/wiki/p", id: "t", key: "A-1", title: "T" },
        { description: "/wiki/pp", id: "t2", key: "A-2", title: "T2" },
      ]),
    },
    pages: { findVisible: vi.fn(async () => ({ id: "p" })) },
  } as unknown as WikiRepository;

  await expect(
    new WikiSearchService(repository, access).backlinks(actor, "p"),
  ).resolves.toEqual({
    pages: [{ icon: null, id: "l", title: "L" }],
    projects: [{ id: "pr", name: "P" }],
    tickets: [{ id: "t", key: "A-1", title: "T" }],
  });
});
