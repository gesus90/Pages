import { beforeEach, describe, expect, it } from "vitest";

import {
  WikiAccessDeniedError,
  WikiPageNotFoundError,
} from "@/backend/error/WikiErrors";

import { createPeopleWorld } from "./wiki-people";

let world = createPeopleWorld();

function isDeleted(id: string): boolean {
  return world.state.data.pages.get(id)?.deletedAt !== null;
}

beforeEach(() => {
  world = createPeopleWorld();
  world.addPage({ id: "root", ownerId: "owner" });
  world.addPage({ id: "kid", ownerId: "owner", parentId: "root" });
  world.addPage({ id: "kid-2", ownerId: "other", parentId: "root" });
  world.addPage({
    id: "team",
    ownerId: "owner",
    projectId: "alpha",
    scope: "project",
  });
  world.addPage({ id: "mine", ownerId: "owner", scope: "private" });
});

describe("deleting into the trash", () => {
  it("marks the page and its subtree and records project activity", async () => {
    await world.trashService().delete(world.actor("owner"), "root");
    expect(["root", "kid", "kid-2"].map(isDeleted)).toEqual([true, true, true]);
    expect(world.state.data.pages.get("kid")?.deletedRootId).toBe("root");
    expect(isDeleted("team")).toBe(false);
    await world.trashService().delete(world.actor("owner"), "team");
    expect(world.state.data.activity).toMatchObject([
      { action: "wiki_page_deleted", projectId: "alpha", wikiPageId: "team" },
    ]);
  });

  it("keeps an earlier deletion of a child under its own root", async () => {
    await world.trashService().delete(world.actor("owner"), "kid");
    await world.trashService().delete(world.actor("owner"), "root");
    expect(world.state.data.pages.get("kid")?.deletedRootId).toBe("kid");
    expect(world.state.data.pages.get("kid-2")?.deletedRootId).toBe("root");
  });

  it.each(["other", "manager"])(
    "refuses %s on an instance page of somebody else",
    async (actor) => {
      await expect(
        world.trashService().delete(world.actor(actor), "root"),
      ).rejects.toBeInstanceOf(WikiAccessDeniedError);
      expect(isDeleted("root")).toBe(false);
    },
  );

  it("allows an administrator and a project manager where they manage", async () => {
    await world.trashService().delete(world.actor("admin"), "root");
    await world.trashService().delete(world.actor("manager"), "team");
    expect(isDeleted("root")).toBe(true);
    expect(isDeleted("team")).toBe(true);
  });

  it("treats a page of somebody else's private area as missing", async () => {
    await expect(
      world.trashService().delete(world.actor("admin"), "mine"),
    ).rejects.toBeInstanceOf(WikiPageNotFoundError);
    expect(isDeleted("mine")).toBe(false);
  });

  it("does not find a page that is already in the trash", async () => {
    await world.trashService().delete(world.actor("owner"), "root");
    await expect(
      world.trashService().delete(world.actor("owner"), "root"),
    ).rejects.toBeInstanceOf(WikiPageNotFoundError);
  });
});

describe("restoring", () => {
  beforeEach(async () => {
    await world.trashService().delete(world.actor("owner"), "kid");
    await world.trashService().delete(world.actor("owner"), "root");
  });

  it("brings a root back with the pages deleted with it", async () => {
    await world.trashService().restore(world.actor("owner"), "root");
    expect(isDeleted("root")).toBe(false);
    expect(isDeleted("kid-2")).toBe(false);
    expect(isDeleted("kid")).toBe(true);
  });

  it("returns a page whose parent is still deleted as a root page", async () => {
    await world.trashService().restore(world.actor("owner"), "kid");
    expect(isDeleted("kid")).toBe(false);
    expect(world.page("kid").parentId).toBeNull();
  });

  it("keeps the parent when it is alive", async () => {
    await world.trashService().restore(world.actor("owner"), "root");
    await world.trashService().delete(world.actor("other"), "kid-2");
    await world.trashService().restore(world.actor("owner"), "kid");
    expect(world.page("kid").parentId).toBe("root");
    await world.trashService().restore(world.actor("other"), "kid-2");
    expect(world.page("kid-2").parentId).toBe("root");
  });

  it("refuses a page that is not a deletion root", async () => {
    await expect(
      world.trashService().restore(world.actor("owner"), "kid-2"),
    ).rejects.toMatchObject({ code: "notInTrash" });
    await expect(
      world.trashService().restore(world.actor("owner"), "team"),
    ).rejects.toMatchObject({ code: "notInTrash" });
  });

  it("refuses an actor who does not manage the page", async () => {
    await expect(
      world.trashService().restore(world.actor("other"), "root"),
    ).rejects.toBeInstanceOf(WikiAccessDeniedError);
    expect(isDeleted("root")).toBe(true);
  });

  it("answers an unknown or hidden page with not found", async () => {
    await expect(
      world.trashService().restore(world.actor("owner"), "missing"),
    ).rejects.toBeInstanceOf(WikiPageNotFoundError);
    await world.trashService().delete(world.actor("owner"), "mine");
    await expect(
      world.trashService().restore(world.actor("admin"), "mine"),
    ).rejects.toBeInstanceOf(WikiPageNotFoundError);
    await world.trashService().restore(world.actor("owner"), "mine");
    expect(isDeleted("mine")).toBe(false);
  });
});

describe("listing the trash", () => {
  beforeEach(async () => {
    await world.trashService().delete(world.actor("owner"), "root");
    await world.trashService().delete(world.actor("owner"), "team");
    await world.trashService().delete(world.actor("owner"), "mine");
  });

  it("shows an ordinary account only its own deleted pages", async () => {
    const own = await world.trashService().list(world.actor("owner"));
    expect(own.map((entry) => entry.id).sort()).toEqual([
      "mine",
      "root",
      "team",
    ]);
    await expect(
      world.trashService().list(world.actor("other")),
    ).resolves.toEqual([]);
  });

  it("shows managers and administrators the pages of others, never private ones", async () => {
    const forManager = await world.trashService().list(world.actor("manager"));
    expect(forManager.map((entry) => entry.id).sort()).toEqual([
      "root",
      "team",
    ]);
    const forAdmin = await world.trashService().list(world.actor("admin"));
    expect(forAdmin.map((entry) => entry.id)).not.toContain("mine");
  });
});

describe("removing for good", () => {
  beforeEach(async () => {
    world.addAttachment({ id: "att", pageId: "kid", storageName: "file-1" });
    world.addComment({ id: "note", pageId: "kid" });
    await world.trashService().delete(world.actor("owner"), "root");
  });

  it("deletes the tree and returns the file names to remove", async () => {
    const files = await world
      .trashService()
      .purge(world.actor("owner"), "root");
    expect(files).toEqual(["file-1"]);
    expect(["root", "kid", "kid-2"].map((id) => world.hasPage(id))).toEqual([
      false,
      false,
      false,
    ]);
    expect(world.state.data.comments.size).toBe(0);
    expect(world.state.data.attachments.size).toBe(0);
    expect(world.hasPage("team")).toBe(true);
  });

  it("does not remove anything for a page outside the trash or for a stranger", async () => {
    await expect(
      world.trashService().purge(world.actor("owner"), "team"),
    ).rejects.toMatchObject({ code: "notInTrash" });
    await expect(
      world.trashService().purge(world.actor("other"), "root"),
    ).rejects.toBeInstanceOf(WikiAccessDeniedError);
    await expect(
      world.trashService().purge(world.actor("owner"), "kid"),
    ).rejects.toMatchObject({ code: "notInTrash" });
    expect(world.hasPage("kid")).toBe(true);
  });

  it("removes every expired tree in one transaction", async () => {
    await world.trashService().delete(world.actor("owner"), "team");
    world.state.expiredRoots = ["root", "team"];
    const before = world.state.transactions;
    const files = await world.trashService().purgeExpired(30);
    expect(files).toEqual(["file-1"]);
    expect(world.state.transactions - before).toBe(1);
    expect(world.hasPage("root")).toBe(false);
    expect(world.hasPage("team")).toBe(false);
    expect(world.hasPage("mine")).toBe(true);
  });
});
