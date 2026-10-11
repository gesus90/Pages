import { describe, expect, it, vi } from "vitest";

import { WikiPageReader } from "@/backend/service/wiki/WikiPageReader";
import { WikiPageNotFoundError } from "@/backend/error/WikiErrors";
import { previewStructuredImport } from "@/backend/service/agents/StructuredImportPreview";
import { previewWiki } from "@/backend/service/agents/StructuredImportWikiPreview";

import {
  applyStructured,
  structuredManifest,
  useStructuredImportHarness,
} from "../helpers/structured-import";

import type { AgentImportIssue } from "@/definition/AgentImportManifest";
import type { StructuredHarness } from "../helpers/structured-import";
import type { AgentStructuredManifest } from "@/definition/AgentStructuredImportManifest";
import type { StructuredWikiPlan } from "@/backend/service/agents/StructuredImportWikiPreview";

const setup = useStructuredImportHarness();

async function wikiPlan(
  harness: StructuredHarness,
  manifest: AgentStructuredManifest = structuredManifest(),
): Promise<StructuredWikiPlan> {
  const preview = await previewStructuredImport(harness.environment, {
    manifest,
  });
  if (!preview.wiki) throw new Error("Expected wiki plan.");
  return preview.wiki;
}

describe("structured wiki preview diagnosis", () => {
  it("converts errors with and without target keys or limits and matches source keys", async () => {
    const harness = await setup();
    const wiki = await wikiPlan(harness);
    const errors: AgentImportIssue[] = [
      {
        code: "INVALID_REQUEST",
        reason: "tree_too_deep",
        sourceKeys: [],
        targetKey: "directory:guide",
        limit: 8,
      },
      {
        code: "INVALID_REQUEST",
        reason: "invalid_title",
        sourceKeys: ["guide/start.md"],
      },
    ];
    const result = await previewWiki(harness.environment, {
      ...wiki,
      plan: { ...wiki.plan, errors },
    });
    expect(result.errors).toEqual([
      {
        code: "INVALID_REQUEST",
        reason: "tree_too_deep",
        keys: ["directory:guide"],
        limit: 8,
      },
      {
        code: "INVALID_REQUEST",
        reason: "invalid_title",
        keys: ["guide/start.md"],
      },
    ]);
    expect(result.objects.map((entry) => entry.action)).toEqual([
      "invalid",
      "invalid",
    ]);
  });

  it("retains unrelated conflicts, flags source conflicts and blocks children of unusable parents", async () => {
    const harness = await setup();
    const wiki = await wikiPlan(harness);
    const conflicts: AgentImportIssue[] = [
      {
        code: "CONFLICT",
        reason: "group_content_conflict",
        targetKey: "directory:guide",
        sourceKeys: [],
      },
      {
        code: "CONFLICT",
        reason: "title_conflict",
        sourceKeys: ["unrelated.md"],
      },
    ];
    const result = await previewWiki(harness.environment, {
      ...wiki,
      plan: { ...wiki.plan, conflicts },
    });
    expect(result.objects).toMatchObject([
      { action: "conflict", reason: "source_changed" },
      { action: "blocked", reason: "blocked" },
    ]);
    expect(result.conflicts).toContainEqual({
      code: "CONFLICT",
      reason: "title_conflict",
      keys: ["unrelated.md"],
    });
  });

  it("recognizes title conflicts from page action or matching plan issues", async () => {
    const harness = await setup();
    const wiki = await wikiPlan(harness);
    for (const fromIssue of [true, false]) {
      const result = await previewWiki(harness.environment, {
        ...wiki,
        plan: {
          ...wiki.plan,
          pages: wiki.plan.pages.map((page) => ({
            ...page,
            action: fromIssue ? "create" : "conflict",
          })),
          conflicts: fromIssue
            ? [
                {
                  code: "CONFLICT",
                  reason: "title_conflict",
                  sourceKeys: ["guide/start.md"],
                },
              ]
            : [],
        },
      });
      expect(
        result.objects.find((entry) => entry.sourceKey === "guide/start.md"),
      ).toMatchObject({ action: "conflict", reason: "title_conflict" });
    }
  });

  it("supports root pages without parent edges and explicit existing parents", async () => {
    const harness = await setup();
    const wiki = await wikiPlan(harness);
    const result = await previewWiki(harness.environment, {
      ...wiki,
      plan: { ...wiki.plan, edges: [] },
    });
    expect(result.objects.every((entry) => entry.action === "create")).toBe(
      true,
    );
    expect(result.edges.every((entry) => entry.to === "existing:root")).toBe(
      true,
    );
    const explicit = await previewWiki(harness.environment, {
      ...wiki,
      plan: {
        ...wiki.plan,
        edges: wiki.plan.pages.map((page) => ({
          childKey: page.key,
          parent: { kind: "existing", pageId: "existing" },
        })),
      },
    });
    expect(
      explicit.edges.every((entry) => entry.to === "existing:existing"),
    ).toBe(true);
  });
});

describe("structured wiki preview mappings", () => {
  it("suppresses only the imported page's title conflict and reports source or target changes", async () => {
    const harness = await setup();
    await applyStructured(harness);
    const wiki = await wikiPlan(harness);
    expect(
      (await previewWiki(harness.environment, wiki)).objects.map(
        (entry) => entry.action,
      ),
    ).toEqual(["unchanged", "unchanged"]);
    const mapping = await harness.environment.imports.findSource(
      "p1",
      "guide/start.md",
    );
    if (!mapping) throw new Error("Expected mapping.");
    await harness.database.execute(
      "UPDATE agent_import_sources SET content_hash = 'changed' WHERE source_key = 'guide/start.md';",
    );
    expect(
      (await previewWiki(harness.environment, wiki)).objects[1],
    ).toMatchObject({ action: "conflict", reason: "source_changed" });
    await harness.environment.imports.refreshSource(mapping);
    for (const statement of [
      "UPDATE wiki_pages SET revision = revision + 1 WHERE id = $id;",
      "UPDATE wiki_pages SET parent_id = NULL WHERE id = $id;",
      "UPDATE wiki_pages SET is_template = 1 WHERE id = $id;",
    ]) {
      const page = await new WikiPageReader(harness.environment.wiki).require(
        harness.environment.viewer.scope,
        mapping.targetId,
      );
      await harness.database.execute(statement, { id: mapping.targetId });
      expect(
        (await previewWiki(harness.environment, wiki)).objects[1],
      ).toMatchObject({ reason: "target_changed" });
      await harness.database.execute(
        "UPDATE wiki_pages SET revision = $revision, parent_id = $parent, is_template = 0 WHERE id = $id;",
        { revision: page.revision, parent: page.parentId, id: page.id },
      );
    }
    const noFiles = {
      ...wiki,
      package: {
        ...wiki.package,
        request: {
          ...wiki.package.request,
          manifest: { ...wiki.package.request.manifest, files: [] },
        },
      },
      plan: { ...wiki.plan, edges: [] },
    };
    expect(
      (await previewWiki(harness.environment, noFiles)).objects[1],
    ).toMatchObject({ reason: "source_changed" });
  });

  it("never reuses removed, differently typed, foreign or private mappings and propagates unexpected read failures", async () => {
    const harness = await setup();
    await applyStructured(harness);
    const wiki = await wikiPlan(harness);
    const mapping = await harness.environment.imports.findSource(
      "p1",
      "guide/start.md",
    );
    if (!mapping) throw new Error("Expected mapping.");
    await harness.database.execute(
      "UPDATE agent_import_sources SET target_kind = 'ticket' WHERE source_key = 'guide/start.md';",
    );
    expect(
      (await previewWiki(harness.environment, wiki)).objects[1],
    ).toMatchObject({ reason: "target_removed", targetId: null });
    await harness.database.execute(
      "UPDATE agent_import_sources SET target_kind = 'wiki' WHERE source_key = 'guide/start.md';",
    );
    const require = vi.spyOn(WikiPageReader.prototype, "require");
    const page = await new WikiPageReader(harness.environment.wiki).require(
      harness.environment.viewer.scope,
      mapping.targetId,
    );
    for (const changed of [
      { projectId: "p2" },
      { scope: "instance" as const },
    ]) {
      require
        .mockResolvedValueOnce({ ...page, ...changed })
        .mockResolvedValueOnce({ ...page, ...changed });
      const result = await previewWiki(harness.environment, wiki);
      expect(result.objects[0]).toMatchObject({ reason: "target_removed" });
    }
    require.mockRejectedValueOnce(new WikiPageNotFoundError());
    expect(
      (await previewWiki(harness.environment, wiki)).objects[0],
    ).toMatchObject({ reason: "target_removed" });
    const failure = new Error("reader unavailable");
    require.mockRejectedValueOnce(failure);
    await expect(previewWiki(harness.environment, wiki)).rejects.toBe(failure);
  });
});

it("compares a mapped loaded page whose plan omits its parent edge", async () => {
  const harness = await setup();
  await applyStructured(harness);
  const wiki = await wikiPlan(harness);
  const result = await previewWiki(harness.environment, {
    ...wiki,
    plan: { ...wiki.plan, edges: [] },
  });
  expect(result.objects[1]).toMatchObject({
    action: "conflict",
    reason: "source_changed",
  });
});
