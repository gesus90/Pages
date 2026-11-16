import { expect, it, vi } from "vitest";

import { McpWikiDetailService } from "@/backend/service/mcp/wiki/McpWikiDetailService";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { McpWikiContext } from "@/backend/service/mcp/wiki/McpWikiContext";

it("lists each thread before its replies and resolves authors", async () => {
  const comment = {
    id: "parent",
    authorId: "user",
    authorName: "User",
    body: "Question",
  };
  const reply = { ...comment, id: "reply", body: "Answer" };
  const person = vi.fn(async () => ({ username: "user", displayName: "User" }));
  const context = partial<McpWikiContext>({
    actor: { id: "actor" },
    person,
    services: {
      wiki: { listComments: async () => [{ comment, replies: [reply] }] },
    },
  });
  await expect(
    new McpWikiDetailService().comments(context, "page"),
  ).resolves.toMatchObject({
    comments: [
      { id: "parent", parentId: null, body: "Question" },
      { id: "reply", parentId: "parent", body: "Answer" },
    ],
  });
  expect(person).toHaveBeenCalledTimes(2);
});

it("adds a reply through the wiki service with its quote", async () => {
  const addComment = vi.fn(async () => ({
    id: "reply",
    authorId: "user",
    authorName: "User",
    body: "Answer",
  }));
  const context = partial<McpWikiContext>({
    actor: { id: "actor" },
    person: async () => ({ username: "user", displayName: "User" }),
    services: { wiki: { addComment } },
  });
  await expect(
    new McpWikiDetailService().addComment(context, "page", {
      body: "Answer",
      parentId: "parent",
      quote: "Text",
    }),
  ).resolves.toMatchObject({ comment: { id: "reply", parentId: "parent" } });
  expect(addComment).toHaveBeenCalledWith(context.actor, "page", {
    body: "Answer",
    parentId: "parent",
    quote: "Text",
    quotePrefix: null,
    quoteSuffix: null,
  });
});
