import { expect, it, vi } from "vitest";

import { extractMentions, syncMentions } from "./WikiMentions";

import type { WikiRepository } from "@/backend/database/repositories/WikiRepository";

it("extracts each mentioned name once without trailing punctuation", () => {
  expect(extractMentions("hi @ann. and (@bob) @ann @_ mail a@b")).toEqual([
    "ann",
    "bob",
  ]);
});

it("stores the mentioned users except the author", async () => {
  const replace = vi.fn(async () => {});
  const find = vi.fn(async () => [{ id: "a" }, { id: "me" }]);
  const repository = {
    lookups: { findActiveUsersByUsernames: find },
    mentions: { replace },
  } as unknown as WikiRepository;
  const source = { authorId: "me", commentId: "", pageId: "p", text: "@a @me" };

  await syncMentions(repository, source);

  expect(find).toHaveBeenCalledWith(["a", "me"]);
  expect(replace).toHaveBeenCalledWith(source, ["a"]);
});
