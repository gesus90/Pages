import { expect, it, vi } from "vitest";

import {
  McpWikiPageService,
  replaceUniquePassage,
} from "@/backend/service/mcp/wiki/McpWikiPageService";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { McpWikiContext } from "@/backend/service/mcp/wiki/McpWikiContext";

it("replaces exactly one passage and rejects missing or overlapping matches", () => {
  expect(replaceUniquePassage("before text after", "text", "new")).toBe(
    "before new after",
  );
  expect(() => replaceUniquePassage("hello", "missing", "x")).toThrow();
  expect(() => replaceUniquePassage("aaa", "aa", "x")).toThrow();
});

it("filters the navigation by scope and visible project", async () => {
  const navigation = vi.fn(async () => ({
    nodes: [
      { id: "a", scope: "project", projectId: "one" },
      { id: "b", scope: "project", projectId: "two" },
      { id: "c", scope: "global", projectId: null },
    ],
    projects: [
      { id: "one", name: "One" },
      { id: "two", name: "Two" },
    ],
    canCreate: true,
  }));
  const context = partial<McpWikiContext>({
    actor: { id: "actor" },
    services: { wiki: { navigation } },
  });
  const service = new McpWikiPageService();
  await expect(
    service.tree(context, { scope: "project", projectId: "one" }),
  ).resolves.toEqual({
    pages: [{ id: "a", scope: "project", projectId: "one" }],
    projects: [{ id: "one", name: "One" }],
    canCreate: true,
  });
  await expect(
    service.tree(context, { scope: "private", projectId: "one" }),
  ).rejects.toMatchObject({ code: "invalid_request" });
  await expect(
    service.tree(context, { projectId: "missing" }),
  ).rejects.toMatchObject({ code: "not_found" });
});

it("previews a move using the current scope and project without writing", async () => {
  const previewMove = vi.fn(async () => ({ affected: 1 }));
  const move = vi.fn();
  const context = partial<McpWikiContext>({
    actor: { id: "actor" },
    atomically: async (work: () => Promise<unknown>) => work(),
    pageAtRevision: async () => ({
      page: { scope: "project", projectId: "project" },
    }),
    services: { wiki: { previewMove, move } },
  });
  await expect(
    new McpWikiPageService().move(context, "page", {
      expectedRevision: 2,
      preview: true,
      parentId: "parent",
    }),
  ).resolves.toEqual({ preview: { affected: 1 } });
  expect(previewMove).toHaveBeenCalledWith(context.actor, "page", {
    scope: "project",
    projectId: "project",
    parentId: "parent",
    beforeId: null,
  });
  expect(move).not.toHaveBeenCalled();
});
