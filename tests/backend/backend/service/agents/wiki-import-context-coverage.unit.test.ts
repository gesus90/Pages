import { describe, expect, it, vi } from "vitest";

import {
  readWikiImportParents,
  requireWikiImportPage,
} from "@/backend/service/agents/WikiImportContext";
import { WIKI_SCOPE } from "@/definition/Wiki";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { WikiImportContext } from "@/backend/service/agents/WikiImportContext";

function contextFor(pages: Record<string, object>): WikiImportContext {
  return partial<WikiImportContext>({
    projectId: "project",
    viewer: { scope: { projectIds: ["project"] } },
    wiki: {
      pages: {
        findVisible: vi.fn(
          async (scope: unknown, id: string) => (void scope, pages[id] ?? null),
        ),
      },
    },
  });
}

function page(
  id: string,
  parentId: string | null,
  changes: object = {},
): object {
  return {
    id,
    parentId,
    projectId: "project",
    scope: WIKI_SCOPE.PROJECT,
    revision: 2,
    isTemplate: false,
    ...changes,
  };
}

describe("wiki import visibility", () => {
  it("reads a visible ancestor chain in order and accepts an empty chain", async () => {
    const context = contextFor({
      child: page("child", "root"),
      root: page("root", null),
    });
    await expect(readWikiImportParents(context, "child")).resolves.toEqual([
      { id: "child", revision: 2, parentId: "root" },
      { id: "root", revision: 2, parentId: null },
    ]);
    await expect(readWikiImportParents(context, null)).resolves.toEqual([]);
  });

  it("rejects templates as selected parent and foreign project or scope", async () => {
    for (const changes of [
      { isTemplate: true },
      { projectId: "other" },
      { scope: WIKI_SCOPE.PRIVATE },
    ]) {
      await expect(
        readWikiImportParents(contextFor({ p: page("p", null, changes) }), "p"),
      ).rejects.toThrow();
    }
  });

  it("rechecks visibility and project before exposing a page", async () => {
    const context = contextFor({
      ok: page("ok", null),
      foreign: page("foreign", null, { projectId: "other" }),
    });
    await expect(requireWikiImportPage(context, "ok")).resolves.toBeUndefined();
    await expect(requireWikiImportPage(context, "foreign")).rejects.toThrow();
    await expect(requireWikiImportPage(context, "missing")).rejects.toThrow();
  });
});
