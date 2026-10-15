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

beforeEach(() => {
  world = createPeopleWorld();
  world.addTarget("department", "sales");
  world.addPage({ id: "wide", ownerId: "owner" });
  world.addPage({
    id: "team",
    ownerId: "owner",
    projectId: "alpha",
    scope: "project",
  });
  world.addPage({ id: "mine", ownerId: "owner", scope: "private" });
  world.addPage({ id: "anchored", ownerId: "owner" });
  world.addAnchor("anchored", "department", "sales");
});

describe("previewing a move", () => {
  it.each([
    {
      label: "from private to instance",
      id: "mine",
      target: to({}),
      change: "wider",
    },
    {
      label: "from instance to private",
      id: "wide",
      target: to({ scope: "private" }),
      change: "narrower",
    },
    {
      label: "from project to instance",
      id: "team",
      target: to({}),
      change: "wider",
    },
    {
      label: "from instance to a project",
      id: "wide",
      target: to({ projectId: "alpha", scope: "project" }),
      change: "narrower",
    },
    { label: "within instance", id: "wide", target: to({}), change: "same" },
  ])("reports $change $label", async ({ id, target, change }) => {
    await expect(
      world.moveService().preview(world.actor("owner"), id, target),
    ).resolves.toBe(change);
  });

  it("hides a project the actor cannot read and reports a different audience otherwise", async () => {
    world.addPage({
      id: "other-project",
      ownerId: "admin",
      projectId: "beta",
      scope: "project",
    });
    await expect(
      world
        .moveService()
        .preview(
          world.actor("owner"),
          "team",
          to({ parentId: "other-project" }),
        ),
    ).rejects.toBeInstanceOf(WikiPageNotFoundError);
    await expect(
      world
        .moveService()
        .preview(
          world.actor("admin"),
          "other-project",
          to({ projectId: "alpha", scope: "project" }),
        ),
    ).resolves.toBe("different");
  });

  it("reports narrower when the page gains an anchor from its new parent", async () => {
    await expect(
      world
        .moveService()
        .preview(world.actor("owner"), "wide", to({ parentId: "anchored" })),
    ).resolves.toBe("narrower");
  });

  it("reports wider when the page loses the anchors it inherited", async () => {
    world.addPage({
      id: "below",
      ownerId: "owner",
      parentId: "anchored",
    });
    await expect(
      world.moveService().preview(world.actor("owner"), "below", to({})),
    ).resolves.toBe("wider");
  });

  it("changes nothing and applies the same rules as a move", async () => {
    await world
      .moveService()
      .preview(world.actor("owner"), "wide", to({ parentId: "anchored" }));
    expect(world.page("wide").parentId).toBeNull();
    expect(world.state.data.activity).toEqual([]);
    await expect(
      world.moveService().preview(world.actor("other"), "wide", to({})),
    ).rejects.toBeInstanceOf(WikiAccessDeniedError);
    await expect(
      world
        .moveService()
        .preview(world.actor("owner"), "wide", to({ scope: null })),
    ).rejects.toMatchObject({ code: "invalidScope" });
  });
});
