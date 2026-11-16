import { expect, it, vi } from "vitest";

import { previewWiki } from "@/backend/service/agents/StructuredImportWikiPreview";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { StructuredImportEnvironment } from "@/backend/service/agents/StructuredImportEnvironment";
import type { StructuredWikiPlan } from "@/backend/service/agents/StructuredImportWikiPreview";

it("plans parent-first pages and blocks a child whose parent conflicts", async () => {
  const findSource = vi.fn(async () => null);
  const environment = partial<StructuredImportEnvironment>({
    imports: { findSource },
  });
  const wiki = partial<StructuredWikiPlan>({
    package: {
      projectId: "project",
      projectKey: "project-key",
      request: {
        projectId: "project",
        parentId: null,
        manifest: {
          version: "1",
          index: [],
          files: [
            { sourceKey: "parent.md", content: "Parent" },
            { sourceKey: "child.md", content: "Child" },
          ],
        },
      },
      bindings: [],
    },
    plan: {
      fingerprint: "hash",
      pages: [
        {
          key: "parent",
          title: "Parent",
          sourceKeys: ["parent.md"],
          action: "conflict",
        },
        {
          key: "child",
          title: "Child",
          sourceKeys: ["child.md"],
          action: "create",
        },
      ],
      edges: [
        { childKey: "parent", parent: { kind: "existing", pageId: null } },
        { childKey: "child", parent: { kind: "planned", key: "parent" } },
      ],
      errors: [],
      conflicts: [],
      assets: [],
    },
  });
  const result = await previewWiki(environment, wiki);
  expect(
    result.objects.map((entry) => [entry.key, entry.action, entry.reason]),
  ).toEqual([
    ["parent", "conflict", "title_conflict"],
    ["child", "blocked", "blocked"],
  ]);
  expect(result.edges).toEqual([
    { type: "wiki_parent", from: "parent", to: "existing:root" },
    { type: "wiki_parent", from: "child", to: "parent" },
  ]);
  expect(result.conflicts).toMatchObject([
    { reason: "title_conflict", keys: ["parent"] },
  ]);
});

it("reports a mapped target of the wrong kind as removed", async () => {
  const environment = partial<StructuredImportEnvironment>({
    imports: {
      findSource: async () => ({ targetKind: "ticket", targetId: "old" }),
    },
  });
  const wiki = partial<StructuredWikiPlan>({
    package: {
      projectId: "project",
      projectKey: "project-key",
      request: {
        projectId: "project",
        parentId: null,
        manifest: {
          version: "1",
          index: [],
          files: [{ sourceKey: "page.md", content: "Page" }],
        },
      },
      bindings: [],
    },
    plan: {
      fingerprint: "hash",
      pages: [
        {
          key: "page",
          title: "Page",
          sourceKeys: ["page.md"],
          action: "create",
        },
      ],
      edges: [],
      errors: [],
      conflicts: [],
      assets: [],
    },
  });
  const result = await previewWiki(environment, wiki);
  expect(result.objects).toMatchObject([
    {
      key: "page",
      action: "conflict",
      reason: "target_removed",
      targetId: null,
    },
  ]);
});
