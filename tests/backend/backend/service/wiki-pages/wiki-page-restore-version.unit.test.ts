import { beforeEach, describe, expect, it } from "vitest";

import {
  WikiAccessDeniedError,
  WikiPageNotFoundError,
} from "@/backend/error/WikiErrors";

import { createPeopleWorld } from "./wiki-people";

let world = createPeopleWorld();

beforeEach(async () => {
  world = createPeopleWorld();
  world.addPage({
    content: "First",
    icon: "📘",
    id: "page",
    ownerId: "owner",
    title: "First title",
  });
  world.state.data.versions.push({
    authorId: "owner",
    authorName: "Owner",
    content: "First",
    createdAt: "2026-10-15 10:00:00",
    id: "v1",
    pageId: "page",
    revision: 1,
    title: "First title",
    updatedAt: "2026-10-15 10:00:00",
  });
  await world.pageService().update(world.actor("owner"), "page", {
    coalesceVersions: false,
    content: "Second",
    expectedRevision: 1,
    icon: "📘",
    title: "Second title",
  });
});

describe("restoring a version", () => {
  it("puts text and title back with a new version on top", async () => {
    const restored = await world
      .pageService()
      .restoreVersion(world.actor("owner"), "page", "v1");
    expect(restored).toMatchObject({
      content: "First",
      icon: "📘",
      revision: 3,
      title: "First title",
    });
    expect(world.state.data.versions.map((row) => row.revision)).toEqual([
      1, 2, 3,
    ]);
  });

  it("never refreshes the newest version, even for the same author", async () => {
    await world
      .pageService()
      .restoreVersion(world.actor("owner"), "page", "v1");
    const newest = world.state.data.versions.at(-1);
    expect(newest).toMatchObject({ content: "First", revision: 3 });
    expect(world.state.data.versions).toHaveLength(3);
  });

  it("changes nothing when the version equals the current text", async () => {
    await world
      .pageService()
      .restoreVersion(world.actor("owner"), "page", "v1");
    const again = await world
      .pageService()
      .restoreVersion(world.actor("owner"), "page", "v1");
    expect(again.revision).toBe(3);
    expect(world.state.data.versions).toHaveLength(3);
  });

  it("refuses an unknown version", async () => {
    await expect(
      world
        .pageService()
        .restoreVersion(world.actor("owner"), "page", "missing"),
    ).rejects.toMatchObject({ code: "versionMissing" });
    expect(world.page("page").revision).toBe(2);
  });

  it("does not take a version of another page", async () => {
    world.addPage({ id: "elsewhere", ownerId: "owner" });
    await expect(
      world
        .pageService()
        .restoreVersion(world.actor("owner"), "elsewhere", "v1"),
    ).rejects.toMatchObject({ code: "versionMissing" });
  });

  it("needs write and a visible page", async () => {
    await expect(
      world.pageService().restoreVersion(world.actor("reader"), "page", "v1"),
    ).rejects.toBeInstanceOf(WikiAccessDeniedError);
    world.addPage({ id: "private", ownerId: "other", scope: "private" });
    await expect(
      world.pageService().restoreVersion(world.actor("owner"), "private", "v1"),
    ).rejects.toBeInstanceOf(WikiPageNotFoundError);
    expect(world.page("page").revision).toBe(2);
  });
});
