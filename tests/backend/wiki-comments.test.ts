import { describe, expect, it } from "vitest";

import {
  WikiAccessDeniedError,
  WikiPageNotFoundError,
} from "@/backend/error/WikiErrors";
import { extractMentions } from "@/backend/service/wiki/WikiMentions";
import {
  collapseWhitespace,
  toPlainText,
} from "@/backend/service/wiki/WikiPlainText";

import { useMigratedDatabase } from "../helpers/test-database";
import { createWikiHarness, pageInput } from "../helpers/wiki-harness";

import type { CommentInput } from "@/backend/service/WikiService";

const plain = (
  body: string,
  overrides: Partial<CommentInput> = {},
): CommentInput => ({
  body,
  parentId: null,
  quote: null,
  quotePrefix: null,
  quoteSuffix: null,
  ...overrides,
});

describe("mentions in text", () => {
  it("reads user names with the punctuation of a sentence removed", () => {
    expect(
      extractMentions(
        "Hi @ada, @Bob.Smith. and (@carol) but not mail@host or @@x @.",
      ),
    ).toEqual(["ada", "Bob.Smith", "carol"]);
    expect(extractMentions("@ada @ada")).toEqual(["ada"]);
    expect(extractMentions("nothing")).toEqual([]);
  });
});

describe("plain text", () => {
  it("reduces markdown to what a reader sees", () => {
    expect(
      toPlainText(
        [
          "# Title **bold**",
          "- [x] done _item_",
          "> [!NOTE]",
          "> quote `code`",
          "```ts",
          "const a = 1;",
          "```",
          "| a | b |",
          "| --- | --- |",
          "| [link](http://x) | ![img](y) |",
        ].join("\n"),
      ),
    ).toBe("Title bold done item quote code const a = 1; a b link img");
    expect(collapseWhitespace("  a \n\t b  ")).toBe("a b");
    expect(toPlainText("<!-- block:a1 -->\nBlock text")).toBe("Block text");
  });
});

describe("wiki comments", () => {
  const getDatabase = useMigratedDatabase();

  async function setup() {
    const harness = createWikiHarness(getDatabase());

    await harness.addDepartment("sales");

    const ada = await harness.addUser("ada", {
      departments: ["sales"],
      displayName: "Ada",
    });
    const bob = await harness.addUser("bob", { displayName: "Bob" });
    const carol = await harness.addUser("carol", { capabilities: [] });
    const admin = await harness.addUser("admin", {
      isAdmin: true,
      mode: "admin",
    });
    const page = await harness.service.create(
      ada,
      pageInput({ content: "alpha beta gamma", title: "Doc" }),
    );

    return { ...harness, ada, admin, bob, carol, page };
  }

  it("adds comments and replies and lists them as threads", async () => {
    const { ada, bob, carol, page, service } = await setup();
    const first = await service.addComment(bob, page.id, plain("  First  "));

    await service.addComment(
      ada,
      page.id,
      plain("Answer", { parentId: first.id }),
    );
    await service.addComment(carol, page.id, plain("Readers may comment too"));

    const threads = await service.listComments(bob, page.id);

    expect(threads.map((thread) => thread.comment.body)).toEqual([
      "First",
      "Readers may comment too",
    ]);
    expect(threads[0]?.replies.map((reply) => reply.body)).toEqual(["Answer"]);
    expect(threads[0]?.comment).toMatchObject({
      authorName: "Bob",
      canChange: true,
      isStale: false,
    });
    expect(threads[0]?.replies[0]?.canChange).toBe(false);
  });

  it("validates the text and the reply target", async () => {
    const { ada, bob, page, service } = await setup();
    const other = await service.create(ada, pageInput({ title: "Other" }));
    const root = await service.addComment(bob, page.id, plain("root"));
    const reply = await service.addComment(
      bob,
      page.id,
      plain("reply", { parentId: root.id }),
    );
    const foreign = await service.addComment(ada, other.id, plain("elsewhere"));

    await expect(
      service.addComment(bob, page.id, plain("   ")),
    ).rejects.toMatchObject({ code: "commentRequired" });
    await expect(
      service.addComment(bob, page.id, plain("x".repeat(5001))),
    ).rejects.toMatchObject({
      code: "commentTooLong",
    });

    for (const parentId of [reply.id, foreign.id, "missing"]) {
      await expect(
        service.addComment(bob, page.id, plain("x", { parentId })),
      ).rejects.toMatchObject({
        code: "invalidParent",
      });
    }
  });

  it("keeps the quoted passage with its surroundings and marks it stale when it is gone", async () => {
    const { ada, bob, page, service } = await setup();

    await service.addComment(
      bob,
      page.id,
      plain("About beta", {
        quote: " beta ",
        quotePrefix: "alpha ",
        quoteSuffix: " gamma",
      }),
    );
    await service.addComment(
      bob,
      page.id,
      plain("Over markup", { quote: "alpha  beta" }),
    );
    await service.addComment(
      bob,
      page.id,
      plain("Long", {
        quote: "q".repeat(600),
        quotePrefix: "p".repeat(60),
        quoteSuffix: "  ",
      }),
    );

    const threads = await service.listComments(bob, page.id);
    const beta = threads.find((thread) => thread.comment.body === "About beta");
    const long = threads.find((thread) => thread.comment.body === "Long");

    expect(beta?.comment).toMatchObject({
      isStale: false,
      quote: "beta",
      quotePrefix: "alpha",
      quoteSuffix: "gamma",
    });
    expect(long?.comment.quote).toHaveLength(500);
    expect(long?.comment.quotePrefix).toHaveLength(40);
    expect(long?.comment.quoteSuffix).toBeNull();
    expect(long?.comment.isStale).toBe(true);

    const current = await service.read(ada, page.id);
    const revision = current.kind === "page" ? current.view.page.revision : 0;

    await service.update(ada, page.id, {
      content: "alpha gamma",
      expectedRevision: revision,
      icon: null,
      title: "Doc",
    });

    expect((await service.listComments(bob, page.id))[0]?.comment.isStale).toBe(
      true,
    );
  });

  it("lets the author edit and the author, owner and administrators delete", async () => {
    const { ada, admin, bob, carol, page, service } = await setup();
    const mine = await service.addComment(bob, page.id, plain("mine"));
    const theirs = await service.addComment(carol, page.id, plain("theirs"));

    await service.editComment(bob, mine.id, "edited");
    await expect(
      service.editComment(ada, mine.id, "hijack"),
    ).rejects.toBeInstanceOf(WikiAccessDeniedError);
    await expect(service.editComment(bob, mine.id, " ")).rejects.toMatchObject({
      code: "commentRequired",
    });
    await expect(service.removeComment(bob, theirs.id)).rejects.toBeInstanceOf(
      WikiAccessDeniedError,
    );
    await service.removeComment(ada, theirs.id);
    await service.removeComment(bob, mine.id);

    const again = await service.addComment(bob, page.id, plain("again"));

    await service.removeComment(admin, again.id);
    await expect(service.removeComment(admin, again.id)).rejects.toBeInstanceOf(
      WikiPageNotFoundError,
    );
    expect(await service.listComments(ada, page.id)).toEqual([]);
  });

  it("deletes the replies and mentions with a comment", async () => {
    const { ada, bob, page, service, database } = await setup();
    const root = await service.addComment(bob, page.id, plain("root @ada"));

    await service.addComment(
      ada,
      page.id,
      plain("answer @bob", { parentId: root.id }),
    );
    await service.removeComment(bob, root.id);

    expect(await database.query("SELECT COUNT(*) FROM wiki_comments;")).toEqual(
      [[0]],
    );
    expect(await database.query("SELECT COUNT(*) FROM wiki_mentions;")).toEqual(
      [[0]],
    );
  });

  it("names an author that no longer exists as empty text", async () => {
    const { bob, page, service, database } = await setup();

    await service.addComment(bob, page.id, plain("orphan"));
    await database.execute("UPDATE wiki_comments SET author_id = 'ghost';");

    expect(
      (await service.listComments(bob, page.id))[0]?.comment.authorName,
    ).toBe("");
  });

  it("resolves a thread and opens it again", async () => {
    const { ada, bob, page, service } = await setup();
    const root = await service.addComment(bob, page.id, plain("root"));
    const reply = await service.addComment(
      bob,
      page.id,
      plain("reply", { parentId: root.id }),
    );

    await service.resolveComment(ada, root.id, true);

    expect(
      (await service.listComments(bob, page.id))[0]?.comment,
    ).toMatchObject({ resolvedByName: "Ada" });
    expect(
      (await service.listComments(bob, page.id))[0]?.comment.resolvedAt,
    ).not.toBeNull();

    await service.resolveComment(ada, root.id, false);

    expect(
      (await service.listComments(bob, page.id))[0]?.comment.resolvedAt,
    ).toBeNull();
    await expect(
      service.resolveComment(ada, reply.id, true),
    ).rejects.toMatchObject({ code: "invalidParent" });
  });

  it("shows comments only to people who see the page", async () => {
    const { ada, bob, service } = await setup();
    const secret = await service.create(
      ada,
      pageInput({ scope: "private", title: "Secret" }),
    );
    const comment = await service.addComment(
      ada,
      secret.id,
      plain("note @bob"),
    );

    await expect(service.listComments(bob, secret.id)).rejects.toBeInstanceOf(
      WikiPageNotFoundError,
    );
    await expect(
      service.addComment(bob, secret.id, plain("x")),
    ).rejects.toBeInstanceOf(WikiPageNotFoundError);
    await expect(
      service.editComment(bob, comment.id, "x"),
    ).rejects.toBeInstanceOf(WikiPageNotFoundError);
    await expect(
      service.resolveComment(bob, comment.id, true),
    ).rejects.toBeInstanceOf(WikiPageNotFoundError);
    expect(await service.forMe(bob)).toEqual([]);
  });
});

describe("wiki area For me", () => {
  const getDatabase = useMigratedDatabase();

  async function setup() {
    const harness = createWikiHarness(getDatabase());

    await harness.addDepartment("sales");

    const ada = await harness.addUser("ada", { displayName: "Ada" });
    const bob = await harness.addUser("bob", { displayName: "Bob" });
    const sales = await harness.addUser("sales", { departments: ["sales"] });

    return { ...harness, ada, bob, sales };
  }

  it("collects mentions, replies, comments on own pages and expired pages", async () => {
    const { ada, bob, service } = await setup();
    const mine = await service.create(ada, pageInput({ title: "Mine" }));
    const theirs = await service.create(bob, pageInput({ title: "Theirs" }));

    await service.setCurrentUntil(ada, mine.id, "2020-01-01");
    await service.addComment(bob, mine.id, plain("Nice page"));
    await service.addComment(bob, mine.id, plain("Look @ada"));

    const adaComment = await service.addComment(
      ada,
      theirs.id,
      plain("Question"),
    );

    await service.addComment(
      bob,
      theirs.id,
      plain("Answer", { parentId: adaComment.id }),
    );
    await service.addComment(bob, theirs.id, plain("Ignored"));

    const items = await service.forMe(ada);

    expect(items.map((item) => item.reason).sort()).toEqual([
      "comment",
      "expired",
      "mention",
      "reply",
    ]);
    expect(items.find((item) => item.reason === "mention")).toMatchObject({
      actorName: "Bob",
      excerpt: "Look @ada",
      pageTitle: "Mine",
    });
    expect(items.find((item) => item.reason === "expired")).toMatchObject({
      at: "2020-01-01 00:00:00",
      excerpt: "",
      pageTitle: "Mine",
    });
    expect(items.every((item) => item.isUnread)).toBe(true);
  });

  it("marks entries as read until something new happens", async () => {
    const { ada, bob, service, database } = await setup();
    const mine = await service.create(ada, pageInput({ title: "Mine" }));

    await service.addComment(bob, mine.id, plain("first"));
    await service.markFeedRead(ada);

    expect((await service.forMe(ada)).map((item) => item.isUnread)).toEqual([
      false,
    ]);

    await database.execute(
      "UPDATE wiki_user_state SET feed_read_at = '2000-01-01 00:00:00' WHERE user_id = 'ada';",
    );
    await service.markFeedRead(ada);

    await service.addComment(bob, mine.id, plain("second"));
    await database.execute(
      "UPDATE wiki_comments SET created_at = '2999-01-01 00:00:00' WHERE body = 'second';",
    );

    expect(
      (await service.forMe(ada)).map((item) => [item.excerpt, item.isUnread]),
    ).toEqual([
      ["second", true],
      ["first", false],
    ]);
  });

  it("records mentions in the page text, keeps them across saves and drops them with the text", async () => {
    const { ada, bob, service, database } = await setup();
    const page = await service.create(
      ada,
      pageInput({ content: "hello @BOB", title: "Notes" }),
    );

    expect((await service.forMe(bob)).map((item) => item.reason)).toEqual([
      "mention",
    ]);

    const [{ created_at: before } = { created_at: "" }] = (
      await database.query("SELECT created_at FROM wiki_mentions;")
    ).map((row) => ({ created_at: String(row[0]) }));

    await service.update(ada, page.id, {
      content: "hello @bob and @ghost",
      expectedRevision: 1,
      icon: null,
      title: "Notes",
    });

    expect(
      await database.query("SELECT created_at FROM wiki_mentions;"),
    ).toEqual([[before]]);

    await service.update(ada, page.id, {
      content: "no mention",
      expectedRevision: 2,
      icon: null,
      title: "Notes",
    });

    expect(await service.forMe(bob)).toEqual([]);
  });

  it("never lists pages the person may not see, nor mentions on private pages", async () => {
    const { ada, bob, sales, service } = await setup();
    const hidden = await service.create(
      ada,
      pageInput({
        anchors: [],
        content: "@sales",
        scope: "instance",
        title: "Hidden",
      }),
    );

    await service.setCurrentUntil(ada, hidden.id, "2020-01-01");
    await getDatabase().execute(
      "INSERT INTO wiki_page_anchors VALUES ($id, 'department', 'sales');",
      { id: hidden.id },
    );
    await service.create(
      ada,
      pageInput({ content: "@bob", scope: "private", title: "Diary" }),
    );

    expect(await service.forMe(bob)).toEqual([]);
    expect((await service.forMe(sales)).map((item) => item.reason)).toEqual([
      "mention",
    ]);
    expect(await service.forMe(ada)).toEqual([]);
  });
});
