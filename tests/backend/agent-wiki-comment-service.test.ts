import { expect, it, vi } from "vitest";

import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";

import {
  addAgentComment,
  addedComment,
  COMMENT_READER,
  COMMENT_WRITER,
  commentThreads,
  useAgentCommentHarness,
} from "../helpers/wiki-agent-comments";
import { wikiFieldState } from "../helpers/wiki-fields";
import { pageInput } from "../helpers/wiki-harness";

const setup = useAgentCommentHarness();

it("allows a reader to add and reply, exposes only public fields, and publishes after durable commit", async () => {
  const harness = await setup();
  const event = vi.fn();
  const committed: Promise<unknown>[] = [];
  harness.dependencies.events.subscribe(event);
  const unsubscribe = harness.dependencies.events.subscribe(() => {
    committed.push(
      harness.database.query(
        "SELECT operation_id FROM agent_operation_keys ORDER BY operation_id;",
      ),
    );
  });
  const root = await addAgentComment(harness, { quote: "Original" });
  expect(root).toEqual({
    commentId: expect.any(String),
    pageId: harness.page.id,
    link: `/wiki/${harness.page.id}`,
    parentId: null,
    isStale: false,
  });
  const reply = await addAgentComment(harness, {
    operationId: "reply",
    parentId: root.commentId,
    body: " Answer ",
  });
  expect(reply.parentId).toBe(root.commentId);
  const result = commentThreads(
    await harness.comments.read(COMMENT_READER, {
      pageId: `/wiki/${harness.page.id}`,
    }),
  );
  const publicComment = {
    id: root.commentId,
    parentId: null,
    authorName: "Reader",
    body: "Original comment",
    quote: "Original",
    isStale: false,
    createdAt: expect.any(String),
    updatedAt: expect.any(String),
    isResolved: false,
    resolvedAt: null,
    resolvedByName: null,
    canEdit: true,
    canDelete: true,
  };
  expect(result).toEqual({
    pageId: harness.page.id,
    link: `/wiki/${harness.page.id}`,
    threads: [
      {
        comment: publicComment,
        replies: [
          {
            ...publicComment,
            id: reply.commentId,
            parentId: root.commentId,
            body: "Answer",
            quote: null,
          },
        ],
      },
    ],
  });
  expect(event.mock.calls).toEqual([
    [{ type: "wiki.comments.changed", id: harness.page.id }],
    [{ type: "wiki.comments.changed", id: harness.page.id }],
  ]);
  expect(await Promise.all(committed)).toEqual([
    [["add"]],
    [["add"], ["reply"]],
  ]);
  unsubscribe();
  await addAgentComment(harness, {
    operationId: "second-root",
    body: "Second",
  });
  expect(committed).toHaveLength(2);
  expect(
    commentThreads(
      await harness.comments.read(COMMENT_WRITER, { pageId: harness.page.id }),
    ).threads.map((thread) => [
      thread.comment.body,
      thread.comment.canEdit,
      thread.comment.canDelete,
    ]),
  ).toEqual([
    ["Original comment", false, true],
    ["Second", false, true],
  ]);
});

it("edits only the author's text, keeps no-op metadata, and synchronizes mentions like the UI", async () => {
  const harness = await setup();
  await harness.addUser("inactive");
  await harness.database.execute(
    "UPDATE users SET is_active = FALSE WHERE id = 'inactive';",
  );
  const root = await addAgentComment(harness, {
    body: " Hello @writer @reader @inactive @ghost ",
  });
  expect(
    (await harness.service.forMe(harness.actor)).map((entry) => [
      entry.reason,
      entry.excerpt,
    ]),
  ).toEqual([["mention", "Hello @writer @reader @inactive @ghost"]]);
  expect(
    await harness.database.query("SELECT user_id FROM wiki_mentions;"),
  ).toEqual([["writer"]]);
  const input = {
    operationId: "edit",
    commentId: root.commentId,
    body: " New @owner ",
  };
  const events = vi.fn();
  harness.dependencies.events.subscribe(events);
  const response = await harness.comments.apply(
    COMMENT_READER,
    "wiki.comment.edit",
    input,
  );
  expect(response).toEqual({
    apiVersion: "1",
    result: {
      commentId: root.commentId,
      pageId: harness.page.id,
      link: `/wiki/${harness.page.id}`,
      action: "edited",
      changed: true,
      deletedComments: 0,
    },
  });
  expect(
    await harness.database.query("SELECT user_id FROM wiki_mentions;"),
  ).toEqual([["owner"]]);
  expect(
    (await harness.service.forMe(harness.actor)).map((entry) => entry.reason),
  ).toEqual(["comment"]);
  const state = await wikiFieldState(harness.database);
  expect(
    await harness.comments.apply(COMMENT_READER, "wiki.comment.edit", {
      ...input,
      operationId: "unchanged",
    }),
  ).toMatchObject({ result: { changed: false } });
  expect(await wikiFieldState(harness.database)).toEqual(state);
  expect(
    await harness.comments.apply(COMMENT_READER, "wiki.comment.edit", input),
  ).toEqual(response);
  expect(events).toHaveBeenCalledExactlyOnceWith({
    type: "wiki.comments.changed",
    id: harness.page.id,
  });
});

it("resolves and reopens as a reader, preserves resolver metadata on no-op, and refuses replies", async () => {
  const harness = await setup();
  const root = await addAgentComment(harness);
  const reply = await addAgentComment(harness, {
    operationId: "reply",
    parentId: root.commentId,
  });
  const input = {
    operationId: "resolve",
    commentId: root.commentId,
    resolved: true,
  };
  const events = vi.fn();
  harness.dependencies.events.subscribe(events);
  expect(
    await harness.comments.apply(COMMENT_WRITER, "wiki.comment.resolve", input),
  ).toMatchObject({ result: { action: "resolved", changed: true } });
  expect(
    commentThreads(
      await harness.comments.read(COMMENT_READER, { pageId: harness.page.id }),
    ).threads[0]?.comment,
  ).toMatchObject({
    isResolved: true,
    resolvedAt: expect.any(String),
    resolvedByName: "writer",
  });
  const state = await wikiFieldState(harness.database);
  expect(
    await harness.comments.apply(COMMENT_READER, "wiki.comment.resolve", {
      ...input,
      operationId: "already-resolved",
    }),
  ).toMatchObject({ result: { action: "resolved", changed: false } });
  expect(await wikiFieldState(harness.database)).toEqual(state);
  const reopen = { ...input, operationId: "reopen", resolved: false };
  expect(
    await harness.comments.apply(
      COMMENT_READER,
      "wiki.comment.resolve",
      reopen,
    ),
  ).toMatchObject({ result: { action: "reopened", changed: true } });
  expect(
    await harness.comments.apply(COMMENT_READER, "wiki.comment.resolve", {
      ...reopen,
      operationId: "already-open",
    }),
  ).toMatchObject({ result: { action: "reopened", changed: false } });
  expect(
    commentThreads(
      await harness.comments.read(COMMENT_READER, { pageId: harness.page.id }),
    ).threads[0]?.comment,
  ).toMatchObject({
    isResolved: false,
    resolvedAt: null,
    resolvedByName: null,
  });
  const before = await wikiFieldState(harness.database, {
    includeOperationKeys: true,
  });
  for (const resolved of [true, false])
    await expect(
      harness.comments.apply(COMMENT_READER, "wiki.comment.resolve", {
        ...input,
        operationId: "invalid-reply",
        commentId: reply.commentId,
        resolved,
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  expect(
    await wikiFieldState(harness.database, { includeOperationKeys: true }),
  ).toEqual(before);
  expect(events).toHaveBeenCalledTimes(2);
});

it("deletes a reply alone or an entire thread with mentions, reports the count, and replays deletion", async () => {
  const harness = await setup();
  const root = await addAgentComment(harness, { body: "Root @writer" });
  const reply = await addAgentComment(harness, {
    operationId: "reply",
    parentId: root.commentId,
    body: "Reply @writer",
  });
  await addAgentComment(harness, { operationId: "kept", body: "Other" });
  expect(
    await harness.comments.apply(COMMENT_READER, "wiki.comment.delete", {
      operationId: "delete-reply",
      commentId: reply.commentId,
    }),
  ).toMatchObject({
    result: { action: "deleted", deletedComments: 1, changed: true },
  });
  await addAgentComment(harness, {
    operationId: "reply-again",
    parentId: root.commentId,
    body: "Reply @writer",
  });
  const input = { operationId: "delete-root", commentId: root.commentId };
  const response = await harness.comments.apply(
    COMMENT_WRITER,
    "wiki.comment.delete",
    input,
  );
  expect(response).toMatchObject({
    result: { action: "deleted", deletedComments: 2, changed: true },
  });
  const before = await wikiFieldState(harness.database, {
    includeOperationKeys: true,
  });
  expect(
    await harness.comments.apply(COMMENT_WRITER, "wiki.comment.delete", input),
  ).toEqual(response);
  expect(
    await wikiFieldState(harness.database, { includeOperationKeys: true }),
  ).toEqual(before);
  expect(
    await harness.database.query("SELECT body FROM wiki_comments;"),
  ).toEqual([["Other"]]);
  expect(
    await harness.database.query("SELECT COUNT(*) FROM wiki_mentions;"),
  ).toEqual([[0]]);
});

it("marks stale quotes, bounds trimmed Unicode quotes, and suppresses mentions on private pages", async () => {
  const harness = await setup();
  expect((await addAgentComment(harness, { quote: "Gone" })).isStale).toBe(
    true,
  );
  const quoted = await addAgentComment(harness, {
    operationId: "unicode",
    quote: ` ${"😀".repeat(500)} `,
    body: "😀".repeat(5000),
  });
  expect(
    (await harness.repository.comments.find(quoted.commentId))?.quote,
  ).toBe("😀".repeat(500));
  const privatePage = await harness.service.create(
    harness.actor,
    pageInput({ scope: "private", content: "Secret" }),
  );
  const result = addedComment(
    await harness.comments.apply(COMMENT_WRITER, "wiki.comment.add", {
      operationId: "private",
      pageId: privatePage.id,
      body: "Private @reader",
      quote: "  ",
    }),
  );
  expect(result.isStale).toBe(false);
  expect(
    await harness.database.query("SELECT COUNT(*) FROM wiki_mentions;"),
  ).toEqual([[0]]);
});

it("replays canonical addresses, binds keys to account and exact operation, and serializes concurrent retries", async () => {
  const harness = await setup();
  const input = {
    operationId: "parallel",
    pageId: harness.page.id,
    body: "Once",
  };
  const responses = await Promise.all(
    Array.from({ length: 3 }, () =>
      harness.comments.apply(COMMENT_READER, "wiki.comment.add", input),
    ),
  );
  expect(responses[1]).toEqual(responses[0]);
  expect(responses[2]).toEqual(responses[0]);
  expect(
    await harness.comments.apply(COMMENT_READER, "wiki.comment.add", {
      ...input,
      pageId: `https://pages.invalid/wiki/${harness.page.id}`,
      quote: null,
      parentId: null,
    }),
  ).toEqual(responses[0]);
  const before = await wikiFieldState(harness.database, {
    includeOperationKeys: true,
  });
  await expect(
    harness.comments.apply(COMMENT_READER, "wiki.comment.add", {
      ...input,
      body: "Different",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    harness.comments.apply(COMMENT_READER, "wiki.comment.delete", {
      operationId: "parallel",
      commentId: addedComment(responses[0]).commentId,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    await wikiFieldState(harness.database, { includeOperationKeys: true }),
  ).toEqual(before);
  await harness.comments.apply(COMMENT_WRITER, "wiki.comment.add", input);
  expect(
    await harness.database.query("SELECT COUNT(*) FROM wiki_comments;"),
  ).toEqual([[2]]);
  const keys = new AgentOperationKeyRepository(harness.database);
  expect(await keys.find("reader", "parallel")).toMatchObject({
    operation: "wiki.comment.add",
    resultJson: JSON.stringify(responses[0].result),
  });
  expect(await keys.find("writer", "parallel")).not.toBeNull();
});
