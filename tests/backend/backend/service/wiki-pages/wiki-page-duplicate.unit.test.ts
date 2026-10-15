import { beforeEach, describe, expect, it } from "vitest";

import {
  WikiAccessDeniedError,
  WikiPageNotFoundError,
} from "@/backend/error/WikiErrors";

import { createPeopleWorld } from "./wiki-people";

import type { WikiPage } from "@/definition/Wiki";

let world = createPeopleWorld();

async function duplicate(
  actorId: string,
  id: string,
  options: {
    withChildren?: boolean;
    isTemplate?: boolean;
    title?: string;
  } = {},
): Promise<WikiPage> {
  return world.pageService().duplicate(world.actor(actorId), id, {
    isTemplate: options.isTemplate ?? false,
    title: options.title ?? "Copy",
    withChildren: options.withChildren ?? false,
  });
}

beforeEach(() => {
  world = createPeopleWorld();
  world.addTarget("department", "sales");
  world.addPage({
    content: "Source text /wiki/linked",
    icon: "📘",
    id: "source",
    ownerId: "owner",
    projectId: "alpha",
    scope: "project",
    title: "Source",
  });
  world.addAnchor("source", "department", "sales");
  world.addPage({
    id: "child",
    ownerId: "owner",
    parentId: "source",
    projectId: "alpha",
    scope: "project",
    title: "Child",
  });
  world.addPage({
    id: "grandchild",
    ownerId: "owner",
    parentId: "child",
    projectId: "alpha",
    scope: "project",
    title: "Grandchild",
  });
});

describe("duplicating a single page", () => {
  it("copies text and icon for the actor under the new title", async () => {
    const copy = await duplicate("other", "source", { title: "  Copy of it " });
    expect(copy).toMatchObject({
      content: "Source text /wiki/linked",
      icon: "📘",
      isTemplate: false,
      ownerId: "other",
      parentId: null,
      projectId: "alpha",
      revision: 1,
      scope: "project",
      title: "Copy of it",
    });
    expect(copy.id).not.toBe("source");
    expect(world.page("source").ownerId).toBe("owner");
  });

  it("starts a fresh history and records the links of the text", async () => {
    const copy = await duplicate("other", "source");
    expect(world.state.data.versions).toMatchObject([
      { authorId: "other", pageId: copy.id, revision: 1, title: "Copy" },
    ]);
    expect(world.state.data.links.get(copy.id)).toEqual({
      pageIds: ["linked"],
      ticketKeys: [],
    });
  });

  it("keeps anchors whose target still exists and drops the others", async () => {
    world.addAnchor("source", "milestone", "gone");
    const copy = await duplicate("owner", "source");
    expect(world.anchorKeys(copy.id)).toEqual(["department:sales"]);
    expect(world.anchorKeys("source")).toHaveLength(2);
  });

  it("does not copy the pages below", async () => {
    await duplicate("owner", "source");
    expect(world.state.data.pages.size).toBe(4);
  });

  it("can turn the copy of a page into a template", async () => {
    const copy = await duplicate("owner", "source", { isTemplate: true });
    expect(copy.isTemplate).toBe(true);
  });

  it("is appended to the siblings of the original", async () => {
    const copy = await duplicate("owner", "child");
    expect(copy.parentId).toBe("source");
    expect(world.state.data.pages.get(copy.id)?.position).toBe(2);
  });
});

describe("duplicating with children", () => {
  it("copies the subtree with its titles below the copy", async () => {
    const copy = await duplicate("other", "source", { withChildren: true });
    const copies = [...world.state.data.pages.values()]
      .map((row) => row.page)
      .filter((page) => page.ownerId === "other");
    expect(copies.map((page) => page.title).sort()).toEqual([
      "Child",
      "Copy",
      "Grandchild",
    ]);
    const child = copies.find((page) => page.title === "Child");
    const grandchild = copies.find((page) => page.title === "Grandchild");
    expect(child?.parentId).toBe(copy.id);
    expect(grandchild?.parentId).toBe(child?.id);
    expect(world.hasPage("child")).toBe(true);
    expect(world.page("child").parentId).toBe("source");
  });

  it("leaves out children the actor cannot see", async () => {
    world.addPage({
      id: "secret",
      ownerId: "other",
      parentId: "source",
      scope: "private",
      title: "Secret",
    });
    await duplicate("owner", "source", { withChildren: true });
    const titles = [...world.state.data.pages.values()]
      .filter((row) => row.page.ownerId === "owner")
      .map((row) => row.page.title);
    expect(titles).not.toContain("Secret");
    expect(titles.filter((title) => title === "Child")).toHaveLength(2);
  });
});

describe("who may duplicate", () => {
  it("needs write", async () => {
    await expect(duplicate("reader", "source")).rejects.toBeInstanceOf(
      WikiAccessDeniedError,
    );
    expect(world.state.data.pages.size).toBe(3);
  });

  it("needs to see the source", async () => {
    world.addPage({ id: "private", ownerId: "other", scope: "private" });
    await expect(duplicate("owner", "private")).rejects.toBeInstanceOf(
      WikiPageNotFoundError,
    );
  });

  it("validates the title of the copy", async () => {
    await expect(
      duplicate("owner", "source", { title: "" }),
    ).rejects.toMatchObject({ code: "titleRequired" });
    expect(world.state.transactions).toBe(0);
  });
});
