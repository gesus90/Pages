import { beforeEach, describe, expect, it, vi } from "vitest";

import { WikiVersionRepository } from "@/backend/database/repositories/wiki/WikiVersionRepository";
import {
  WikiAccessDeniedError,
  WikiPageNotFoundError,
  WikiValidationError,
} from "@/backend/error/WikiErrors";

import { WikiWorld } from "./wiki-world";

import type { CreateWikiPageInput } from "@/backend/service/wiki/WikiPageService";

const ROOT: CreateWikiPageInput = {
  anchors: [],
  content: "Body",
  icon: null,
  isTemplate: false,
  parentId: null,
  projectId: null,
  scope: "instance",
  templateId: null,
  title: "Title",
};

let world = new WikiWorld();

beforeEach(() => {
  world = new WikiWorld();
  world.addPerson("author", { projects: ["alpha"], departments: ["sales"] });
  world.addPerson("bob");
  world.addPerson("reader", { capabilities: [] });
});

describe("creating a root page", () => {
  it("stores the page for its author with a first version and links", async () => {
    const page = await world.pageService().create(world.actor("author"), {
      ...ROOT,
      content: "See /wiki/other and /tasks/ABC-1",
      icon: " 📘 ",
    });
    expect(page).toMatchObject({
      anchors: [],
      breadcrumb: [],
      icon: "📘",
      ownerId: "author",
      revision: 1,
      scope: "instance",
      title: "Title",
    });
    expect(world.state.data.versions).toMatchObject([
      { authorId: "author", pageId: page.id, revision: 1, title: "Title" },
    ]);
    expect(world.state.data.links.get(page.id)).toEqual({
      pageIds: ["other"],
      ticketKeys: ["ABC-1"],
    });
    expect(world.state.transactions).toBe(1);
  });

  it("refuses an account without the capability write and stores nothing", async () => {
    await expect(
      world.pageService().create(world.actor("reader"), ROOT),
    ).rejects.toBeInstanceOf(WikiAccessDeniedError);
    expect(world.state.data.pages.size).toBe(0);
    expect(world.state.transactions).toBe(0);
  });

  it("normalizes the title to a single line", async () => {
    const page = await world
      .pageService()
      .create(world.actor("author"), { ...ROOT, title: "  Two\n  lines \t " });
    expect(page.title).toBe("Two lines");
  });

  it.each([
    ["   ", "titleRequired"],
    ["x".repeat(201), "titleTooLong"],
  ])("rejects the title %j with %s", async (title, code) => {
    await expect(
      world.pageService().create(world.actor("author"), { ...ROOT, title }),
    ).rejects.toMatchObject({ code, name: "WikiValidationError" });
    expect(world.state.data.pages.size).toBe(0);
  });

  it("accepts a title of exactly 200 characters", async () => {
    const page = await world
      .pageService()
      .create(world.actor("author"), { ...ROOT, title: "ä".repeat(200) });
    expect(page.title).toHaveLength(200);
  });

  it("measures the text in bytes, not characters", async () => {
    const limit = 1_048_576;
    const fits = "a".repeat(limit);
    await expect(
      world
        .pageService()
        .create(world.actor("author"), { ...ROOT, content: fits }),
    ).resolves.toMatchObject({ revision: 1 });
    await expect(
      world.pageService().create(world.actor("author"), {
        ...ROOT,
        content: "é".repeat(limit / 2 + 1),
      }),
    ).rejects.toMatchObject({ code: "contentTooLong" });
  });

  it.each(["abc", "😀😀", "x"])("rejects the icon %j", async (icon) => {
    await expect(
      world.pageService().create(world.actor("author"), { ...ROOT, icon }),
    ).rejects.toMatchObject({ code: "invalidIcon" });
  });

  it("keeps a flag and a family emoji as one icon", async () => {
    for (const icon of ["🇩🇪", "👨‍👩‍👧", "👍🏽"]) {
      const page = await world
        .pageService()
        .create(world.actor("author"), { ...ROOT, icon });
      expect(page.icon).toBe(icon);
    }
  });
});

describe("the place of a new page", () => {
  it("requires a known scope for a root page", async () => {
    await expect(
      world
        .pageService()
        .create(world.actor("author"), { ...ROOT, scope: null }),
    ).rejects.toMatchObject({ code: "invalidScope" });
  });

  it("allows a project page only in a project the author reads", async () => {
    const created = await world.pageService().create(world.actor("author"), {
      ...ROOT,
      projectId: "alpha",
      scope: "project",
    });
    expect(created).toMatchObject({ projectId: "alpha", scope: "project" });
    expect(world.state.data.activity).toMatchObject([
      {
        action: "wiki_page_created",
        projectId: "alpha",
        wikiPageId: created.id,
      },
    ]);
    for (const projectId of ["beta", null]) {
      await expect(
        world.pageService().create(world.actor("author"), {
          ...ROOT,
          projectId,
          scope: "project",
        }),
      ).rejects.toMatchObject({ code: "invalidScope" });
    }
  });

  it("lets a child take scope and project of its parent", async () => {
    world.addPage({
      id: "parent",
      ownerId: "author",
      projectId: "alpha",
      scope: "project",
    });
    const child = await world.pageService().create(world.actor("author"), {
      ...ROOT,
      parentId: "parent",
      projectId: null,
      scope: "private",
    });
    expect(child).toMatchObject({
      breadcrumb: [{ id: "parent" }],
      parentId: "parent",
      projectId: "alpha",
      scope: "project",
    });
  });

  it("answers a hidden parent like a missing one", async () => {
    world.addPage({ id: "secret", ownerId: "bob", scope: "private" });
    for (const parentId of ["secret", "missing"]) {
      await expect(
        world
          .pageService()
          .create(world.actor("author"), { ...ROOT, parentId }),
      ).rejects.toBeInstanceOf(WikiPageNotFoundError);
    }
    expect(world.state.data.pages.size).toBe(1);
  });

  it("refuses a template as parent", async () => {
    world.addPage({ id: "template", isTemplate: true });
    await expect(
      world
        .pageService()
        .create(world.actor("author"), { ...ROOT, parentId: "template" }),
    ).rejects.toMatchObject({ code: "invalidParent" });
  });

  it("allows the tenth level and refuses the eleventh", async () => {
    let parentId: string | null = null;
    for (let level = 1; level <= 9; level += 1) {
      parentId = world.addPage({ id: `level-${level}`, parentId }).id;
    }
    const tenth = await world
      .pageService()
      .create(world.actor("author"), { ...ROOT, parentId });
    await expect(
      world
        .pageService()
        .create(world.actor("author"), { ...ROOT, parentId: tenth.id }),
    ).rejects.toMatchObject({ code: "treeTooDeep" });
  });

  it("appends the page after its siblings", async () => {
    const first = await world.pageService().create(world.actor("author"), ROOT);
    const second = await world
      .pageService()
      .create(world.actor("author"), ROOT);
    expect(world.state.data.pages.get(first.id)?.position).toBe(1);
    expect(world.state.data.pages.get(second.id)?.position).toBe(2);
  });
});

describe("templates, anchors and mentions", () => {
  it("copies text and icon of a visible template instead of the input", async () => {
    world.addPage({
      content: "From template",
      icon: "📌",
      id: "template",
      isTemplate: true,
    });
    const page = await world.pageService().create(world.actor("author"), {
      ...ROOT,
      content: "ignored",
      icon: null,
      templateId: "template",
    });
    expect(page).toMatchObject({ content: "From template", icon: "📌" });
  });

  it.each([
    { label: "an ordinary page", seed: { id: "plain" } },
    {
      label: "a template that is private to someone else",
      seed: {
        id: "plain",
        isTemplate: true,
        ownerId: "bob",
        scope: "private" as const,
      },
    },
  ])("refuses $label as template", async ({ seed }) => {
    world.addPage(seed);
    await expect(
      world
        .pageService()
        .create(world.actor("author"), { ...ROOT, templateId: "plain" }),
    ).rejects.toBeInstanceOf(WikiPageNotFoundError);
  });

  it("refuses anchors on a private page and for unknown targets", async () => {
    world.addTarget("department", "sales");
    const anchors = [{ kind: "department", targetId: "sales" }] as const;
    await expect(
      world
        .pageService()
        .create(world.actor("author"), { ...ROOT, anchors, scope: "private" }),
    ).rejects.toMatchObject({ code: "invalidAnchor" });
    await expect(
      world.pageService().create(world.actor("author"), {
        ...ROOT,
        anchors: [{ kind: "milestone", targetId: "gone" }],
      }),
    ).rejects.toMatchObject({ code: "invalidAnchor" });
  });

  it("stores an anchor once even when it is requested twice", async () => {
    world.addTarget("department", "sales");
    const anchor = { kind: "department", targetId: "sales" } as const;
    const page = await world
      .pageService()
      .create(world.actor("author"), { ...ROOT, anchors: [anchor, anchor] });
    expect(world.anchorKeys(page.id)).toEqual(["department:sales"]);
  });

  it("refuses a department anchor of a department the author is not in", async () => {
    world.addTarget("department", "legal");
    await expect(
      world.pageService().create(world.actor("author"), {
        ...ROOT,
        anchors: [{ kind: "department", targetId: "legal" }],
      }),
    ).rejects.toMatchObject({ code: "invalidAnchor" });
  });

  it("records mentions of active others, but not on private pages", async () => {
    world.addPerson("gone", { isActive: false });
    const content = "Hi @bob, @author and @gone";
    const page = await world
      .pageService()
      .create(world.actor("author"), { ...ROOT, content });
    expect(world.state.data.mentions).toEqual([
      { commentId: "", pageId: page.id, userIds: ["bob"] },
    ]);
    world.state.data.mentions = [];
    await world
      .pageService()
      .create(world.actor("author"), { ...ROOT, content, scope: "private" });
    expect(world.state.data.mentions).toEqual([]);
  });

  it("rolls everything back when a later step fails", async () => {
    vi.spyOn(WikiVersionRepository.prototype, "save").mockRejectedValueOnce(
      new Error("disk full"),
    );
    await expect(
      world.pageService().create(world.actor("author"), ROOT),
    ).rejects.toThrow("disk full");
    expect(world.state.data.pages.size).toBe(0);
    expect(world.state.rollbacks).toBe(1);
  });

  it("raises validation errors as WikiValidationError", async () => {
    await expect(
      world.pageService().create(world.actor("author"), { ...ROOT, title: "" }),
    ).rejects.toBeInstanceOf(WikiValidationError);
  });
});
