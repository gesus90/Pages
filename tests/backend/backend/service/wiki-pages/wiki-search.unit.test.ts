import { beforeEach, describe, expect, it } from "vitest";

import { WikiPageNotFoundError } from "@/backend/error/WikiErrors";

import { createPeopleWorld } from "./wiki-people";

import type { WikiSearchHit } from "@/backend/database/repositories/wiki/WikiSearchRepository";
import type { WikiSearchInput } from "@/backend/service/WikiService";

let world = createPeopleWorld();

function query(overrides: Partial<WikiSearchInput>): WikiSearchInput {
  return {
    creatorId: null,
    editedFrom: null,
    editedTo: null,
    location: null,
    sort: null,
    text: "",
    titleOnly: false,
    underPageId: null,
    ...overrides,
  };
}

function hit(id: string, content: string): WikiSearchHit {
  return {
    content,
    createdAt: "2026-10-15 10:00:00",
    currentUntil: null,
    icon: null,
    id,
    ownerId: "owner",
    ownerName: "Owner",
    parentId: null,
    projectId: null,
    projectName: null,
    scope: "instance",
    title: `Title ${id}`,
    updatedAt: "2026-10-15 10:00:00",
  };
}

beforeEach(() => {
  world = createPeopleWorld();
  world.addPage({ id: "target", ownerId: "owner", title: "Target" });
  world.addPage({ id: "mine", ownerId: "owner", scope: "private" });
});

describe("searching", () => {
  it("does not query without words and without filters", async () => {
    await expect(
      world.facade().search(world.actor("owner"), query({ text: "  " })),
    ).resolves.toEqual({ results: [], total: 0 });
    expect(world.reading.searchCalls).toEqual([]);
  });

  it("splits words and quoted phrases and hands the viewer's scope to the query", async () => {
    await world
      .facade()
      .search(
        world.actor("owner"),
        query({ text: 'budget "Q3 plan" "" open"' }),
      );
    const [call] = world.reading.searchCalls;
    expect(call?.filters).toMatchObject({
      phrases: ["Q3 plan"],
      sort: "relevance",
      terms: ["budget", "open"],
      titleOnly: false,
    });
    expect(call?.scope).toEqual({
      departmentIds: ["sales"],
      isAdmin: false,
      projectIds: ["alpha"],
      userId: "owner",
    });
  });

  it("searches with a filter alone and normalizes location, sort and dates", async () => {
    await world.facade().search(
      world.actor("owner"),
      query({
        creatorId: "other",
        editedFrom: " 2026-01-01 ",
        location: "project:alpha",
        sort: "created",
      }),
    );
    expect(world.reading.searchCalls[0]?.filters).toMatchObject({
      area: { projectId: "alpha", scope: "project" },
      creatorId: "other",
      editedFrom: "2026-01-01",
      sort: "created",
    });
    await world
      .facade()
      .search(
        world.actor("owner"),
        query({ location: "private", sort: "nonsense", text: "x" }),
      );
    expect(world.reading.searchCalls[1]?.filters).toMatchObject({
      area: { scope: "private" },
      sort: "relevance",
    });
  });

  it("rejects an invalid date before searching", async () => {
    await expect(
      world
        .facade()
        .search(
          world.actor("owner"),
          query({ editedTo: "2026-02-31", text: "x" }),
        ),
    ).rejects.toMatchObject({ code: "invalidDate" });
    expect(world.reading.searchCalls).toEqual([]);
  });

  it("cuts a passage around the first hit from the plain text", async () => {
    world.reading.hits = [
      hit(
        "long",
        `${"intro ".repeat(40)}**needle** and more ${"tail ".repeat(40)}`,
      ),
      hit("short", "short **bold** text"),
    ];
    const response = await world
      .facade()
      .search(world.actor("owner"), query({ text: "needle" }));
    expect(response.total).toBe(2);
    const [long, short] = response.results;
    expect(long?.snippet.startsWith("…")).toBe(true);
    expect(long?.snippet.endsWith("…")).toBe(true);
    expect(long?.snippet).toContain("needle and more");
    expect(long).not.toHaveProperty("content");
    expect(short?.snippet).toBe("short bold text");
  });
});

describe("references and links", () => {
  it("offers pages, tickets and people, each marked with its kind", async () => {
    world.reading.hits = [hit("1", ""), hit("2", "")];
    world.reading.ticketSuggestions = [{ key: "ABC-1", title: "Ticket" }];
    world.reading.peopleSuggestions = [
      { displayName: "Bob", id: "bob", username: "bob" },
    ];
    const references = await world
      .facade()
      .references(world.actor("owner"), "title 1");
    expect(references).toEqual([
      { icon: null, id: "1", kind: "page", title: "Title 1" },
      { key: "ABC-1", kind: "ticket", title: "Ticket" },
      { displayName: "Bob", id: "bob", kind: "person", username: "bob" },
    ]);
  });

  it("resolves titles only for pages the person sees", async () => {
    await expect(
      world
        .facade()
        .linkTitles(world.actor("other"), ["target", "mine", "missing"]),
    ).resolves.toEqual({ target: "Target" });
  });
});

describe("backlinks", () => {
  it("keeps tickets and projects whose text really names the page", async () => {
    world.reading.linkingPages = [
      {
        ...hit("linker", ""),
        icon: "🔗",
        title: "Linker",
      },
    ];
    world.reading.mentioningTickets = [
      {
        description: "see /wiki/target.",
        id: "t1",
        key: "ABC-1",
        title: "One",
      },
      {
        description: "see /wiki/target-two",
        id: "t2",
        key: "ABC-2",
        title: "Two",
      },
    ];
    world.reading.mentioningProjects = [
      { description: "/wiki/target", id: "p1", name: "Project" },
      { description: "/wiki/targets", id: "p2", name: "Other" },
    ];
    const result = await world
      .facade()
      .backlinks(world.actor("owner"), "target");
    expect(result).toEqual({
      pages: [{ icon: "🔗", id: "linker", title: "Linker" }],
      projects: [{ id: "p1", name: "Project" }],
      tickets: [{ id: "t1", key: "ABC-1", title: "One" }],
    });
  });

  it("refuses a page the person cannot see", async () => {
    await expect(
      world.facade().backlinks(world.actor("other"), "mine"),
    ).rejects.toBeInstanceOf(WikiPageNotFoundError);
  });
});
