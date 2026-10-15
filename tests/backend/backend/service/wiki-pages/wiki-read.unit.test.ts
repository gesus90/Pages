import { beforeEach, describe, expect, it } from "vitest";

import { WikiPageNotFoundError } from "@/backend/error/WikiErrors";

import { createPeopleWorld } from "./wiki-people";

let world = createPeopleWorld();

beforeEach(() => {
  world = createPeopleWorld();
  world.addTarget("department", "sales");
  world.addPage({
    content: "Welcome",
    id: "home",
    ownerId: "owner",
    title: "Home",
  });
  world.addPage({
    id: "child",
    ownerId: "owner",
    parentId: "home",
    position: 1,
    title: "Child",
  });
  world.addPage({
    id: "team",
    ownerId: "other",
    projectId: "alpha",
    scope: "project",
    title: "Team",
  });
  world.addPage({
    id: "mine",
    ownerId: "owner",
    scope: "private",
    title: "Mine",
  });
  world.addPage({
    id: "template",
    isTemplate: true,
    ownerId: "owner",
    title: "Template",
  });
});

describe("opening a page", () => {
  it("returns the page with children, favorite state and rights", async () => {
    world.reading.favorites.set("owner", ["home"]);
    const result = await world.facade().read(world.actor("owner"), "home");
    expect(result).toMatchObject({
      kind: "page",
      view: {
        children: [{ id: "child", title: "Child" }],
        isFavorite: true,
        page: { anchors: [], breadcrumb: [], id: "home" },
        permissions: { canComment: true, canEdit: true, canManage: true },
      },
    });
  });

  it("tells a reader that the page is not theirs to edit or manage", async () => {
    const result = await world.facade().read(world.actor("reader"), "home");
    expect(result).toMatchObject({
      kind: "page",
      view: {
        isFavorite: false,
        permissions: { canComment: true, canEdit: false, canManage: false },
      },
    });
  });

  it("remembers the visit", async () => {
    await world.facade().read(world.actor("owner"), "home");
    await world.facade().read(world.actor("owner"), "child");
    await world.facade().read(world.actor("owner"), "home");
    expect(world.reading.recent.get("owner")).toEqual(["home", "child"]);
  });

  it("answers a hidden or missing page with not found and no visit", async () => {
    world.addPerson("outsider");
    for (const id of ["mine", "missing", "team"]) {
      await expect(
        world.facade().read(world.actor("outsider"), id),
      ).rejects.toBeInstanceOf(WikiPageNotFoundError);
    }
    expect(world.reading.recent.size).toBe(0);
  });

  it("gives an administrator a placeholder for a private page of somebody else", async () => {
    const result = await world.facade().read(world.actor("admin"), "mine");
    expect(result).toEqual({
      kind: "placeholder",
      placeholder: { id: "mine", ownerId: "owner", ownerName: "Owner" },
    });
    expect(JSON.stringify(result)).not.toContain("Mine");
    await expect(
      world.facade().read(world.actor("admin"), "missing"),
    ).rejects.toBeInstanceOf(WikiPageNotFoundError);
  });
});

describe("navigation and start page", () => {
  it("lists visible pages and keeps only visible personal state", async () => {
    world.reading.favorites.set("other", ["home", "mine", "gone"]);
    world.reading.expanded.set("other", ["home", "mine"]);
    world.reading.recent.set("other", ["child", "mine", "team"]);
    const navigation = await world.facade().navigation(world.actor("other"));
    expect(navigation.nodes.map((node) => node.id).sort()).toEqual([
      "child",
      "home",
      "team",
    ]);
    expect(navigation).toMatchObject({
      canCreate: true,
      expandedIds: ["home"],
      favoriteIds: ["home"],
      recent: [
        { id: "child", title: "Child" },
        { id: "team", title: "Team" },
      ],
    });
  });

  it("does not offer creating to an account without write", async () => {
    await expect(
      world.facade().navigation(world.actor("reader")),
    ).resolves.toMatchObject({ canCreate: false });
  });

  it("builds the start page lists from what the person sees", async () => {
    world.reading.favorites.set("owner", ["team", "mine"]);
    const home = await world.facade().home(world.actor("owner"));
    expect(home.all.map((page) => page.id).sort()).toEqual([
      "child",
      "home",
      "mine",
      "team",
    ]);
    expect(home.mine.map((page) => page.id).sort()).toEqual([
      "child",
      "home",
      "mine",
    ]);
    expect(home.favorites.map((page) => page.id).sort()).toEqual([
      "mine",
      "team",
    ]);
  });

  it("limits the recently edited list to ten pages", async () => {
    for (let index = 0; index < 12; index += 1) {
      world.addPage({ id: `bulk-${index}`, ownerId: "owner" });
    }
    const home = await world.facade().home(world.actor("owner"));
    expect(home.recentlyEdited).toHaveLength(10);
    expect(home.all.length).toBeGreaterThan(10);
  });

  it("lists templates without their text", async () => {
    await expect(
      world.facade().templates(world.actor("owner")),
    ).resolves.toEqual([{ icon: null, id: "template", title: "Template" }]);
  });
});

describe("favorites and open branches", () => {
  it("sets and clears them for a visible page", async () => {
    await world.facade().setFavorite(world.actor("owner"), "home", true);
    await world.facade().setExpanded(world.actor("owner"), "home", true);
    expect(world.reading.favorites.get("owner")).toEqual(["home"]);
    expect(world.reading.expanded.get("owner")).toEqual(["home"]);
    await world.facade().setFavorite(world.actor("owner"), "home", false);
    expect(world.reading.favorites.get("owner")).toEqual([]);
  });

  it("refuses a hidden page and records nothing", async () => {
    await expect(
      world.facade().setFavorite(world.actor("other"), "mine", true),
    ).rejects.toBeInstanceOf(WikiPageNotFoundError);
    await expect(
      world.facade().setExpanded(world.actor("other"), "mine", true),
    ).rejects.toBeInstanceOf(WikiPageNotFoundError);
    expect(world.reading.favorites.size).toBe(0);
    expect(world.reading.expanded.size).toBe(0);
  });
});
