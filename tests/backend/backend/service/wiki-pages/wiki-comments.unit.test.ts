import { beforeEach, describe, expect, it } from "vitest";

import {
  WikiAccessDeniedError,
  WikiPageNotFoundError,
} from "@/backend/error/WikiErrors";

import { createPeopleWorld } from "./wiki-people";

import type { CommentInput } from "@/backend/service/wiki/WikiCommentService";

let world = createPeopleWorld();

function comment(overrides: Partial<CommentInput> = {}): CommentInput {
  return {
    body: "Looks good",
    parentId: null,
    quote: null,
    quotePrefix: null,
    quoteSuffix: null,
    ...overrides,
  };
}

beforeEach(() => {
  world = createPeopleWorld();
  world.addPage({
    content: "The **quick** brown fox",
    id: "page",
    ownerId: "owner",
    projectId: "alpha",
    scope: "project",
  });
  world.addPage({ id: "mine", ownerId: "owner", scope: "private" });
});

describe("adding comments", () => {
  it("stores a trimmed comment and describes it for the author", async () => {
    const added = await world
      .commentService()
      .add(world.actor("other"), "page", comment({ body: "  Nice work \n" }));
    expect(added).toMatchObject({
      authorId: "other",
      authorName: "Other",
      body: "Nice work",
      canChange: true,
      canEdit: true,
      isStale: false,
      pageId: "page",
      resolvedAt: null,
    });
    expect(world.state.data.activity).toMatchObject([
      { action: "wiki_comment_added", projectId: "alpha", wikiPageId: "page" },
    ]);
  });

  it("lets a reader without write comment", async () => {
    await expect(
      world.commentService().add(world.actor("reader"), "page", comment()),
    ).resolves.toMatchObject({ authorId: "reader" });
  });

  it("cuts the quote at 500 and its surroundings at 40 characters", async () => {
    const added = await world.commentService().add(
      world.actor("other"),
      "page",
      comment({
        quote: `  ${"😀".repeat(600)}  `,
        quotePrefix: "p".repeat(100),
        quoteSuffix: "   ",
      }),
    );
    expect(Array.from(added.quote ?? "")).toHaveLength(500);
    expect(added.quotePrefix).toHaveLength(40);
    expect(added.quoteSuffix).toBeNull();
  });

  it.each([
    { label: "empty", body: " \n\t ", code: "commentRequired" },
    { label: "too long", body: "x".repeat(5001), code: "commentTooLong" },
  ])("rejects a $label body before any transaction", async ({ body, code }) => {
    await expect(
      world
        .commentService()
        .add(world.actor("other"), "page", comment({ body })),
    ).rejects.toMatchObject({ code });
    expect(world.state.transactions).toBe(0);
    expect(world.state.data.comments.size).toBe(0);
  });

  it("counts characters, not UTF-16 units, against the limit", async () => {
    await expect(
      world
        .commentService()
        .add(
          world.actor("other"),
          "page",
          comment({ body: "😀".repeat(5000) }),
        ),
    ).resolves.toMatchObject({ pageId: "page" });
  });

  it("answers a hidden page like a missing one", async () => {
    world.addPage({ id: "secret", ownerId: "owner", scope: "private" });
    for (const pageId of ["secret", "missing"]) {
      await expect(
        world.commentService().add(world.actor("other"), pageId, comment()),
      ).rejects.toBeInstanceOf(WikiPageNotFoundError);
    }
  });
});

describe("replies", () => {
  beforeEach(() => {
    world.addComment({ authorId: "owner", id: "first", pageId: "page" });
    world.addComment({
      authorId: "owner",
      id: "reply",
      pageId: "page",
      parentId: "first",
    });
    world.addComment({ authorId: "owner", id: "foreign", pageId: "mine" });
  });

  it("accepts a reply to a first comment of the page", async () => {
    const added = await world
      .commentService()
      .add(world.actor("other"), "page", comment({ parentId: "first" }));
    expect(added.id).toMatch(/^comment-/);
    expect(world.state.data.comments.get(added.id)?.parentId).toBe("first");
  });

  it.each(["reply", "foreign", "missing"])(
    "rejects a reply to %s",
    async (parentId) => {
      const before = world.state.data.comments.size;
      await expect(
        world
          .commentService()
          .add(world.actor("other"), "page", comment({ parentId })),
      ).rejects.toMatchObject({ code: "invalidParent" });
      expect(world.state.data.comments.size).toBe(before);
    },
  );
});

describe("mentions in comments", () => {
  it("records the mentioned accounts under the comment", async () => {
    const added = await world
      .commentService()
      .add(
        world.actor("owner"),
        "page",
        comment({ body: "@other and @owner please look" }),
      );
    expect(world.state.data.mentions).toEqual([
      { commentId: added.id, pageId: "page", userIds: ["other"] },
    ]);
  });

  it("records nothing on a private page", async () => {
    await world
      .commentService()
      .add(world.actor("owner"), "mine", comment({ body: "@other look" }));
    expect(world.state.data.mentions).toEqual([]);
  });
});

describe("listing threads", () => {
  beforeEach(() => {
    world.addComment({
      authorId: "other",
      id: "first",
      pageId: "page",
      quote: "quick   brown",
    });
    world.addComment({
      authorId: "owner",
      id: "reply",
      pageId: "page",
      parentId: "first",
    });
    world.addComment({
      authorId: "other",
      id: "stale",
      pageId: "page",
      quote: "lazy dog",
    });
  });

  it("groups replies under their first comment", async () => {
    const threads = await world
      .commentService()
      .list(world.actor("owner"), "page");
    expect(threads.map((thread) => thread.comment.id)).toEqual([
      "first",
      "stale",
    ]);
    expect(threads[0]?.replies.map((reply) => reply.id)).toEqual(["reply"]);
    expect(threads[1]?.replies).toEqual([]);
  });

  it("marks a comment stale when its passage left the text", async () => {
    const threads = await world
      .commentService()
      .list(world.actor("owner"), "page");
    expect(threads.map((thread) => thread.comment.isStale)).toEqual([
      false,
      true,
    ]);
  });

  it("tells each viewer what they may change", async () => {
    const asOwner = await world
      .commentService()
      .list(world.actor("owner"), "page");
    expect(asOwner[0]?.comment).toMatchObject({
      canChange: true,
      canEdit: false,
    });
    const asOther = await world
      .commentService()
      .list(world.actor("other"), "page");
    expect(asOther[0]?.comment).toMatchObject({
      canChange: true,
      canEdit: true,
    });
    const asReader = await world
      .commentService()
      .list(world.actor("reader"), "page");
    expect(asReader[0]?.comment).toMatchObject({
      canChange: false,
      canEdit: false,
    });
  });

  it("hides the threads of a page the person cannot see", async () => {
    world.addComment({ id: "private", pageId: "mine" });
    await expect(
      world.commentService().list(world.actor("other"), "mine"),
    ).rejects.toBeInstanceOf(WikiPageNotFoundError);
  });
});

describe("editing, deleting and resolving", () => {
  beforeEach(() => {
    world.addComment({ authorId: "other", id: "first", pageId: "page" });
    world.addComment({
      authorId: "reader",
      id: "reply",
      pageId: "page",
      parentId: "first",
    });
  });

  it("lets only the author edit and re-reads mentions", async () => {
    await world
      .commentService()
      .edit(world.actor("other"), "first", " @owner changed ");
    expect(world.state.data.comments.get("first")?.body).toBe("@owner changed");
    expect(world.state.data.mentions).toEqual([
      { commentId: "first", pageId: "page", userIds: ["owner"] },
    ]);
    await expect(
      world.commentService().edit(world.actor("owner"), "first", "Mine now"),
    ).rejects.toBeInstanceOf(WikiAccessDeniedError);
    expect(world.state.data.comments.get("first")?.body).toBe("@owner changed");
  });

  it("validates an edited text", async () => {
    await expect(
      world.commentService().edit(world.actor("other"), "first", "  "),
    ).rejects.toMatchObject({ code: "commentRequired" });
    await expect(
      world.commentService().edit(world.actor("other"), "missing", "text"),
    ).rejects.toBeInstanceOf(WikiPageNotFoundError);
  });

  it.each(["other", "owner"])("lets %s delete the thread", async (actor) => {
    await world.commentService().remove(world.actor(actor), "first");
    expect([...world.state.data.comments.keys()]).toEqual([]);
    expect(world.state.data.activity.map((entry) => entry.action)).toEqual([
      "wiki_comment_deleted",
    ]);
  });

  it("refuses a stranger and keeps the thread", async () => {
    world.addPerson("third", { projects: ["alpha"] });
    await expect(
      world.commentService().remove(world.actor("third"), "first"),
    ).rejects.toBeInstanceOf(WikiAccessDeniedError);
    expect(world.state.data.comments.size).toBe(2);
  });

  it("lets an administrator delete a comment on a shared page", async () => {
    await world.commentService().remove(world.actor("admin"), "reply");
    expect([...world.state.data.comments.keys()]).toEqual(["first"]);
  });

  it("resolves and reopens a thread for anybody who sees it", async () => {
    await world.commentService().resolve(world.actor("reader"), "first", true);
    expect(world.state.data.comments.get("first")).toMatchObject({
      resolvedAt: expect.any(String) as unknown,
      resolvedByName: "Reader",
    });
    await world.commentService().resolve(world.actor("owner"), "first", false);
    expect(world.state.data.comments.get("first")).toMatchObject({
      resolvedAt: null,
      resolvedByName: null,
    });
  });

  it("does not resolve a reply", async () => {
    await expect(
      world.commentService().resolve(world.actor("owner"), "reply", true),
    ).rejects.toMatchObject({ code: "invalidParent" });
  });

  it("treats the comment of a hidden page as missing", async () => {
    world.addComment({ authorId: "owner", id: "private", pageId: "mine" });
    for (const action of [
      world.commentService().resolve(world.actor("other"), "private", true),
      world.commentService().remove(world.actor("other"), "private"),
      world.commentService().edit(world.actor("other"), "private", "text"),
    ]) {
      await expect(action).rejects.toBeInstanceOf(WikiPageNotFoundError);
    }
  });
});
