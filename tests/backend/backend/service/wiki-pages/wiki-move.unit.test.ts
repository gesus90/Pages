import { beforeEach, describe, expect, it } from "vitest";

import {
  WikiAccessDeniedError,
  WikiPageNotFoundError,
} from "@/backend/error/WikiErrors";

import { createPeopleWorld } from "./wiki-people";

import type { MoveWikiPageInput } from "@/backend/service/wiki/WikiMoveService";

let world = createPeopleWorld();

function to(overrides: Partial<MoveWikiPageInput>): MoveWikiPageInput {
  return {
    beforeId: null,
    parentId: null,
    projectId: null,
    scope: "instance",
    ...overrides,
  };
}

function order(parentId: string | null): string[] {
  return [...world.state.data.pages.values()]
    .filter((row) => row.page.parentId === parentId)
    .sort((left, right) => left.position - right.position)
    .map((row) => row.page.id);
}

beforeEach(() => {
  world = createPeopleWorld();
  world.addTarget("department", "sales");
  world.addTarget("milestone", "m1", { projectId: "alpha" });
  world.addPage({ id: "a", ownerId: "owner", position: 1 });
  world.addPage({ id: "b", ownerId: "owner", position: 2 });
  world.addPage({ id: "c", ownerId: "owner", position: 3 });
  world.addPage({ id: "a1", ownerId: "owner", parentId: "a", position: 1 });
  world.addPage({ id: "a2", ownerId: "owner", parentId: "a1", position: 1 });
});

describe("moving within the tree", () => {
  it("appends the page below a new parent", async () => {
    await world
      .moveService()
      .move(world.actor("owner"), "c", to({ parentId: "b" }));
    expect(world.page("c").parentId).toBe("b");
    expect(order("b")).toEqual(["c"]);
    expect(order(null)).toEqual(["a", "b"]);
  });

  it("places the page before the named sibling", async () => {
    await world
      .moveService()
      .move(world.actor("owner"), "c", to({ beforeId: "a" }));
    expect(order(null)).toEqual(["c", "a", "b"]);
    expect(
      [...world.state.data.pages.values()].map((row) => row.position),
    ).toEqual(expect.arrayContaining([1, 2, 3]));
  });

  it("reorders among the same siblings", async () => {
    await world
      .moveService()
      .move(world.actor("owner"), "a", to({ beforeId: "c" }));
    expect(order(null)).toEqual(["b", "a", "c"]);
  });

  it("refuses a position that is no sibling and changes nothing", async () => {
    await expect(
      world
        .moveService()
        .move(world.actor("owner"), "c", to({ beforeId: "a2" })),
    ).rejects.toMatchObject({ code: "invalidPosition" });
    expect(order(null)).toEqual(["a", "b", "c"]);
    expect(world.state.rollbacks).toBe(1);
  });

  it.each(["a", "a1", "a2"])(
    "refuses to move %s below itself or its own subtree",
    async (parentId) => {
      await expect(
        world.moveService().move(world.actor("owner"), "a", to({ parentId })),
      ).rejects.toMatchObject({ code: "invalidParent" });
      expect(world.page("a").parentId).toBeNull();
    },
  );

  it("refuses a template as the new parent", async () => {
    world.addPage({ id: "t", isTemplate: true, ownerId: "owner" });
    await expect(
      world
        .moveService()
        .move(world.actor("owner"), "c", to({ parentId: "t" })),
    ).rejects.toMatchObject({ code: "invalidParent" });
  });

  it("refuses a move that makes the tree deeper than ten levels", async () => {
    let parentId: string | null = null;
    for (let level = 1; level <= 8; level += 1) {
      parentId = world.addPage({ id: `deep-${level}`, parentId }).id;
    }
    // "a" carries two more levels below it: the move would end at level 11.
    await expect(
      world.moveService().move(world.actor("owner"), "a", to({ parentId })),
    ).rejects.toMatchObject({ code: "treeTooDeep" });
    world.addPage({ id: "deep-9", parentId });
    await expect(
      world
        .moveService()
        .move(world.actor("owner"), "c", to({ parentId: "deep-9" })),
    ).resolves.toBeUndefined();
  });
});

describe("who may move", () => {
  it.each(["other", "manager", "reader"])(
    "refuses %s on a page of somebody else",
    async (actor) => {
      await expect(
        world
          .moveService()
          .move(world.actor(actor), "c", to({ parentId: "b" })),
      ).rejects.toBeInstanceOf(WikiAccessDeniedError);
      expect(world.page("c").parentId).toBeNull();
    },
  );

  it("allows an administrator on an instance page", async () => {
    await world
      .moveService()
      .move(world.actor("admin"), "c", to({ parentId: "b" }));
    expect(world.page("c").parentId).toBe("b");
  });

  it("needs write even for the owner", async () => {
    world.addPage({ id: "readers", ownerId: "reader" });
    await expect(
      world
        .moveService()
        .move(world.actor("reader"), "readers", to({ parentId: "b" })),
    ).rejects.toBeInstanceOf(WikiAccessDeniedError);
  });

  it("hides a page the actor cannot see, and a target it cannot see", async () => {
    world.addPage({ id: "secret", ownerId: "other", scope: "private" });
    await expect(
      world
        .moveService()
        .move(world.actor("owner"), "secret", to({ parentId: "b" })),
    ).rejects.toBeInstanceOf(WikiPageNotFoundError);
    await expect(
      world
        .moveService()
        .move(world.actor("owner"), "c", to({ parentId: "secret" })),
    ).rejects.toBeInstanceOf(WikiPageNotFoundError);
  });
});

function seedProjectPages(): void {
  world.addPage({
    id: "team",
    ownerId: "owner",
    projectId: "alpha",
    scope: "project",
  });
  world.addPage({
    id: "team-child",
    ownerId: "owner",
    parentId: "team",
    projectId: "alpha",
    scope: "project",
  });
  world.addAnchor("team", "milestone", "m1");
  world.addAnchor("team-child", "department", "sales");
  world.addAnchor("team-child", "milestone", "m1");
}

describe("moving between areas", () => {
  beforeEach(seedProjectPages);

  it("gives the subtree the scope of the new parent", async () => {
    await world
      .moveService()
      .move(world.actor("owner"), "team", to({ parentId: "b" }));
    expect(world.page("team")).toMatchObject({
      parentId: "b",
      projectId: null,
      scope: "instance",
    });
    expect(world.page("team-child")).toMatchObject({
      projectId: null,
      scope: "instance",
    });
  });

  it("drops milestone anchors when the project changes but keeps departments", async () => {
    await world
      .moveService()
      .move(world.actor("owner"), "team", to({ parentId: "b" }));
    expect(world.anchorKeys("team")).toEqual([]);
    expect(world.anchorKeys("team-child")).toEqual(["department:sales"]);
  });

  it("keeps every anchor when the page stays in its project", async () => {
    world.addPage({
      id: "team-2",
      ownerId: "owner",
      projectId: "alpha",
      scope: "project",
    });
    await world
      .moveService()
      .move(world.actor("owner"), "team", to({ parentId: "team-2" }));
    expect(world.anchorKeys("team")).toEqual(["milestone:m1"]);
    expect(world.anchorKeys("team-child")).toHaveLength(2);
  });

  it("removes all anchors of a subtree that becomes private", async () => {
    await world
      .moveService()
      .move(world.actor("owner"), "team", to({ scope: "private" }));
    expect(world.anchorKeys("team")).toEqual([]);
    expect(world.anchorKeys("team-child")).toEqual([]);
    expect(world.page("team-child").scope).toBe("private");
  });
});

describe("cross-area move authorization and activity", () => {
  beforeEach(seedProjectPages);

  it("makes somebody else's page private only for its owner", async () => {
    await expect(
      world
        .moveService()
        .move(world.actor("admin"), "team", to({ scope: "private" })),
    ).rejects.toMatchObject({ code: "invalidScope" });
    expect(world.page("team").scope).toBe("project");
  });

  it("allows a root project page only in a readable project", async () => {
    await expect(
      world
        .moveService()
        .move(
          world.actor("owner"),
          "b",
          to({ projectId: "beta", scope: "project" }),
        ),
    ).rejects.toMatchObject({ code: "invalidScope" });
    await expect(
      world.moveService().move(world.actor("owner"), "b", to({ scope: null })),
    ).rejects.toMatchObject({ code: "invalidScope" });
    await world
      .moveService()
      .move(
        world.actor("owner"),
        "b",
        to({ projectId: "alpha", scope: "project" }),
      );
    expect(world.page("b")).toMatchObject({
      projectId: "alpha",
      scope: "project",
    });
  });

  it("records the move for the old and for the new project", async () => {
    await world
      .moveService()
      .move(world.actor("owner"), "team", to({ parentId: "b" }));
    expect(world.state.data.activity).toMatchObject([
      { action: "wiki_page_moved", projectId: "alpha", wikiPageId: "team" },
    ]);
    world.state.data.activity = [];
    await world
      .moveService()
      .move(
        world.actor("owner"),
        "c",
        to({ projectId: "alpha", scope: "project" }),
      );
    expect(world.state.data.activity).toMatchObject([
      { action: "wiki_page_moved", projectId: "alpha", wikiPageId: "c" },
    ]);
  });
});
