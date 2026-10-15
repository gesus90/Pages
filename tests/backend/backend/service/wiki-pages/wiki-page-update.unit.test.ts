import { beforeEach, describe, expect, it } from "vitest";

import {
  WikiAccessDeniedError,
  WikiConflictError,
  WikiPageNotFoundError,
} from "@/backend/error/WikiErrors";

import { createPeopleWorld } from "./wiki-people";

import type { UpdateWikiPageInput } from "@/backend/service/wiki/WikiPageService";

let world = createPeopleWorld();

function edit(
  overrides: Partial<UpdateWikiPageInput> = {},
): UpdateWikiPageInput {
  return {
    content: "New text",
    expectedRevision: 1,
    icon: null,
    title: "Old title",
    ...overrides,
  };
}

function actions(): string[] {
  return world.state.data.activity.map((entry) => entry.action);
}

beforeEach(() => {
  world = createPeopleWorld();
  world.addPage({
    content: "Old text",
    id: "page",
    ownerId: "owner",
    projectId: "alpha",
    scope: "project",
    title: "Old title",
  });
});

describe("saving a page", () => {
  it("raises the revision, adds a version and reports what changed", async () => {
    const saved = await world
      .pageService()
      .update(world.actor("owner"), "page", edit({ icon: "📘", title: "New" }));
    expect(saved).toMatchObject({
      content: "New text",
      icon: "📘",
      revision: 2,
      title: "New",
      updatedByName: "Owner",
    });
    expect(world.state.data.versions).toMatchObject([
      { content: "New text", pageId: "page", revision: 2, title: "New" },
    ]);
    expect(actions()).toEqual([
      "wiki_title_changed",
      "wiki_content_changed",
      "wiki_icon_changed",
    ]);
  });

  it("records a link change only when the set of links differs", async () => {
    await world
      .pageService()
      .update(world.actor("owner"), "page", edit({ content: "See /wiki/x" }));
    expect(actions()).toContain("wiki_links_changed");
    world.state.data.activity = [];
    await world
      .pageService()
      .update(
        world.actor("owner"),
        "page",
        edit({ content: "Again /wiki/x", expectedRevision: 2 }),
      );
    expect(actions()).toEqual(["wiki_content_changed"]);
  });

  it("treats an unchanged save as no edit at all", async () => {
    const result = await world
      .pageService()
      .update(
        world.actor("owner"),
        "page",
        edit({ content: "Old text", title: "Old title" }),
      );
    expect(result.revision).toBe(1);
    expect(world.state.data.versions).toEqual([]);
    expect(actions()).toEqual([]);
  });

  it("validates the input before it opens a transaction", async () => {
    await expect(
      world
        .pageService()
        .update(world.actor("owner"), "page", edit({ title: " " })),
    ).rejects.toMatchObject({ code: "titleRequired" });
    expect(world.state.transactions).toBe(0);
    expect(world.page("page").revision).toBe(1);
  });

  it("refuses an account without write and a page that is hidden", async () => {
    await expect(
      world.pageService().update(world.actor("reader"), "page", edit()),
    ).rejects.toBeInstanceOf(WikiAccessDeniedError);
    world.addPage({ id: "private", ownerId: "other", scope: "private" });
    await expect(
      world.pageService().update(world.actor("owner"), "private", edit()),
    ).rejects.toBeInstanceOf(WikiPageNotFoundError);
  });

  it("lets any writer who sees the page edit it", async () => {
    const saved = await world
      .pageService()
      .update(world.actor("other"), "page", edit());
    expect(saved).toMatchObject({ revision: 2, updatedByName: "Other" });
  });
});

describe("conflicts", () => {
  it("answers a stale revision with the stored page and keeps it", async () => {
    await world.pageService().update(world.actor("owner"), "page", edit());
    const failure = await world
      .pageService()
      .update(
        world.actor("other"),
        "page",
        edit({ content: "Mine", expectedRevision: 1 }),
      )
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(WikiConflictError);
    expect(failure).toMatchObject({
      current: { content: "New text", revision: 2, title: "Old title" },
    });
    expect(world.page("page")).toMatchObject({
      content: "New text",
      revision: 2,
    });
    expect(world.state.data.versions).toHaveLength(1);
  });

  it("accepts a stale revision when the values equal the stored ones", async () => {
    await world.pageService().update(world.actor("owner"), "page", edit());
    const retry = await world
      .pageService()
      .update(world.actor("owner"), "page", edit({ expectedRevision: 1 }));
    expect(retry.revision).toBe(2);
    expect(world.state.data.versions).toHaveLength(1);
  });

  it("applies a current revision even when the text is older than another version", async () => {
    await world.pageService().update(world.actor("owner"), "page", edit());
    const saved = await world
      .pageService()
      .update(
        world.actor("owner"),
        "page",
        edit({ content: "Third", expectedRevision: 2 }),
      );
    expect(saved.revision).toBe(3);
  });
});

describe("versions of one author", () => {
  it("refreshes the newest version of the same author", async () => {
    const service = world.pageService();
    await service.update(world.actor("owner"), "page", edit());
    await service.update(
      world.actor("owner"),
      "page",
      edit({ content: "Third", expectedRevision: 2 }),
    );
    expect(world.state.data.versions).toMatchObject([
      { content: "Third", revision: 3 },
    ]);
  });

  it("keeps every version when coalescing is switched off", async () => {
    const service = world.pageService();
    await service.update(
      world.actor("owner"),
      "page",
      edit({ coalesceVersions: false }),
    );
    await service.update(
      world.actor("owner"),
      "page",
      edit({ coalesceVersions: false, content: "Third", expectedRevision: 2 }),
    );
    expect(world.state.data.versions.map((row) => row.revision)).toEqual([
      2, 3,
    ]);
  });

  it("adds a version when another author saves", async () => {
    const service = world.pageService();
    await service.update(world.actor("owner"), "page", edit());
    await service.update(
      world.actor("other"),
      "page",
      edit({ content: "Third", expectedRevision: 2 }),
    );
    expect(world.state.data.versions.map((row) => row.authorId)).toEqual([
      "owner",
      "other",
    ]);
  });
});

describe("mentions on save", () => {
  it("records mentions of public pages and none for private ones", async () => {
    await world
      .pageService()
      .update(world.actor("owner"), "page", edit({ content: "Ping @other" }));
    expect(world.state.data.mentions).toEqual([
      { commentId: "", pageId: "page", userIds: ["other"] },
    ]);
    world.addPage({ id: "mine", ownerId: "owner", scope: "private" });
    await world
      .pageService()
      .update(
        world.actor("owner"),
        "mine",
        edit({ content: "Ping @other", title: "Mine" }),
      );
    expect(world.state.data.mentions.map((row) => row.pageId)).toEqual([
      "page",
    ]);
  });
});
