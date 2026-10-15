import { beforeEach, describe, expect, it } from "vitest";

import { WikiPageNotFoundError } from "@/backend/error/WikiErrors";

import { createPeopleWorld } from "./wiki-people";

let world = createPeopleWorld();

beforeEach(() => {
  world = createPeopleWorld();
  world.addPage({
    content: "Secret text",
    id: "mine",
    ownerId: "owner",
    scope: "private",
    title: "Secret title",
  });
  world.addPage({ id: "mine-2", ownerId: "owner", scope: "private" });
  world.addPage({ id: "theirs", ownerId: "other", scope: "private" });
  world.addPage({ id: "shared", ownerId: "owner" });
});

describe("placeholders of private pages", () => {
  it("shows an administrator only identifier and owner", async () => {
    const placeholder = await world
      .trashService()
      .findPlaceholder(world.actor("admin"), "mine");
    expect(placeholder).toEqual({
      id: "mine",
      ownerId: "owner",
      ownerName: "Owner",
    });
    expect(JSON.stringify(placeholder)).not.toContain("Secret");
  });

  it.each(["owner", "manager", "other"])(
    "gives %s no placeholder",
    async (actor) => {
      await expect(
        world.trashService().findPlaceholder(world.actor(actor), "mine"),
      ).resolves.toBeNull();
    },
  );

  it("has no placeholder for shared, deleted or missing pages", async () => {
    await expect(
      world.trashService().findPlaceholder(world.actor("admin"), "shared"),
    ).resolves.toBeNull();
    await expect(
      world.trashService().findPlaceholder(world.actor("admin"), "missing"),
    ).resolves.toBeNull();
    await world.trashService().delete(world.actor("owner"), "mine");
    await expect(
      world.trashService().findPlaceholder(world.actor("admin"), "mine"),
    ).resolves.toBeNull();
  });

  it("lists the private pages of an account for administrators only", async () => {
    const listed = await world
      .trashService()
      .listPlaceholders(world.actor("admin"), "owner");
    expect(listed.map((entry) => entry.id)).toEqual(["mine", "mine-2"]);
    await expect(
      world.trashService().listPlaceholders(world.actor("manager"), "owner"),
    ).resolves.toEqual([]);
  });

  it("counts and groups them by owner, for administrators only", async () => {
    const counts = await world
      .trashService()
      .countPrivatePages(world.actor("admin"));
    expect(Object.fromEntries(counts)).toEqual({ other: 1, owner: 2 });
    await expect(
      world.trashService().countPrivatePages(world.actor("owner")),
    ).resolves.toEqual(new Map());
    const grouped = await world
      .trashService()
      .listAllPlaceholders(world.actor("admin"));
    expect(Object.keys(grouped).sort()).toEqual(["other", "owner"]);
    expect(grouped.owner?.map((entry) => entry.id)).toEqual(["mine", "mine-2"]);
    await expect(
      world.trashService().listAllPlaceholders(world.actor("owner")),
    ).resolves.toEqual({});
  });

  it("lets an administrator delete a private page into the owner's trash", async () => {
    await world
      .trashService()
      .deletePrivateAsAdministrator(world.actor("admin"), "mine");
    expect(world.state.data.pages.get("mine")).toMatchObject({
      deletedBy: "admin",
      deletedRootId: "mine",
    });
    await expect(
      world.trashService().list(world.actor("owner")),
    ).resolves.toMatchObject([{ id: "mine" }]);
  });

  it("refuses everybody else and pages that have no placeholder", async () => {
    await expect(
      world
        .trashService()
        .deletePrivateAsAdministrator(world.actor("manager"), "mine"),
    ).rejects.toBeInstanceOf(WikiPageNotFoundError);
    await expect(
      world
        .trashService()
        .deletePrivateAsAdministrator(world.actor("admin"), "shared"),
    ).rejects.toBeInstanceOf(WikiPageNotFoundError);
    expect(world.state.data.pages.get("mine")?.deletedAt).toBeNull();
  });
});
