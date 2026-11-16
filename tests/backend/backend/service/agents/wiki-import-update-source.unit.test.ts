import { beforeEach, expect, it, vi } from "vitest";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { WikiImportUpdateScope } from "@/backend/service/agents/WikiImportUpdateSource";
import type { WikiImportSource } from "@/backend/service/agents/WikiImportPackage";

const boundary = vi.hoisted(() => ({ require: vi.fn(), update: vi.fn() }));
vi.mock("@/backend/service/wiki/WikiPageReader", () => ({
  WikiPageReader: class {
    public require = boundary.require;
  },
}));
vi.mock("@/backend/service/wiki/WikiPageService", () => ({
  WikiPageService: class {
    public update = boundary.update;
  },
}));

import { updateWikiImportSource } from "@/backend/service/agents/WikiImportUpdateSource";

const findSource = vi.fn();
const refreshSource = vi.fn();
const siblings = vi.fn();
const source = partial<WikiImportSource>({
  sourceKey: "page.md",
  targetKey: "page",
  page: { title: "Page" },
});
const scope = partial<WikiImportUpdateScope>({
  context: {
    actor: { id: "user" },
    viewer: { scope: {} },
    wiki: { pages: { listProjectChildren: siblings } },
    access: {},
  },
  repository: { findSource, refreshSource },
  plan: {
    errors: [],
    conflicts: [],
    edges: [{ childKey: "page", parent: { kind: "root" } }],
  },
  input: {
    projectId: "project",
    updates: [{ sourceKey: "page.md", expectedRevision: 2, overwrite: false }],
    manifest: { files: [{ sourceKey: "page.md", content: "New content" }] },
  },
  marker: "marker",
});
const mapping = {
  targetKind: "wiki",
  targetId: "page-id",
  targetRevision: 2,
  contentHash: "old",
  resultJson: JSON.stringify({ assets: [] }),
};
const page = {
  id: "page-id",
  projectId: "project",
  scope: "project",
  title: "Page",
  content: "Old content",
  revision: 2,
  parentId: null,
  icon: null,
  isTemplate: false,
};

beforeEach(() => {
  vi.resetAllMocks();
  findSource.mockResolvedValue(mapping);
  boundary.require.mockResolvedValue(page);
  boundary.update.mockResolvedValue({ id: "page-id", revision: 3 });
  siblings.mockResolvedValue([]);
});

it("updates a mapped unchanged revision and advances its baseline", async () => {
  expect(await updateWikiImportSource(scope, source)).toMatchObject({
    action: "updated",
    reason: "source_changed",
    pageId: "page-id",
    revision: 3,
  });
  expect(boundary.update).toHaveBeenCalledWith(
    scope.context.actor,
    "page-id",
    expect.objectContaining({
      content: "New content",
      expectedRevision: 2,
      coalesceVersions: false,
    }),
  );
  expect(refreshSource).toHaveBeenCalledWith(
    expect.objectContaining({
      sourceKey: "page.md",
      targetRevision: 3,
      lastRunId: "marker",
    }),
  );
});

it("skips equal content and updates the baseline without rewriting", async () => {
  boundary.require.mockResolvedValue({ ...page, content: "New content" });
  expect(await updateWikiImportSource(scope, source)).toMatchObject({
    action: "skipped",
    reason: "unchanged",
  });
  expect(boundary.update).not.toHaveBeenCalled();
  expect(refreshSource).toHaveBeenCalledOnce();
});

it("refuses stale or manually changed pages without overwriting", async () => {
  boundary.require.mockResolvedValueOnce({ ...page, revision: 3 });
  expect(await updateWikiImportSource(scope, source)).toMatchObject({
    action: "conflict",
    reason: "stale_revision",
  });
  findSource.mockResolvedValueOnce({ ...mapping, targetRevision: 1 });
  expect(await updateWikiImportSource(scope, source)).toMatchObject({
    action: "conflict",
    reason: "manual_change",
  });
  expect(boundary.update).not.toHaveBeenCalled();
});

it("does not adopt an unmapped page or disclose a page from another project", async () => {
  findSource.mockResolvedValueOnce(null);
  expect(await updateWikiImportSource(scope, source)).toMatchObject({
    action: "failed",
    reason: "not_imported",
  });
  boundary.require.mockResolvedValueOnce({ ...page, projectId: "other" });
  expect(await updateWikiImportSource(scope, source)).toMatchObject({
    action: "failed",
    reason: "page_unavailable",
  });
});
