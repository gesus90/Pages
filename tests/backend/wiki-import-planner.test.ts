import { rmSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { WIKI_LIMITS } from "@/definition/Wiki";
import { useMigratedDatabase } from "../helpers/test-database";
import { pageInput } from "../helpers/wiki-harness";
import {
  createWikiImportHarness,
  importPlan,
  importRequest,
} from "../helpers/wiki-import";

import type { AgentImportPlanInput } from "@/definition/AgentImportManifest";

const examples: AgentImportPlanInput = {
  projectId: "alpha",
  parentId: null,
  manifest: {
    version: "1",
    index: [
      { sourceKey: "guide/README.md", title: "Guide", titleSource: "h1" },
      {
        sourceKey: "bare/without.md",
        title: "without",
        titleSource: "filename",
      },
      { sourceKey: "intro.md", title: "Introduction", titleSource: "h1" },
      { sourceKey: "plain.md", title: "plain", titleSource: "filename" },
      { sourceKey: "explicit.md", title: "Chosen", titleSource: "explicit" },
    ],
    files: [
      { sourceKey: "guide/README.md", content: "# Guide\n" },
      { sourceKey: "bare/without.md", content: "Body" },
      { sourceKey: "intro.md", content: "# Introduction\nBody" },
      { sourceKey: "plain.md", content: "Body" },
      { sourceKey: "explicit.md", content: "# Ignored", title: "Chosen" },
    ],
  },
};

describe("wiki import planning", () => {
  const getDatabase = useMigratedDatabase();
  const directories = new Set<string>();
  afterEach(() => {
    for (const directory of directories)
      rmSync(directory, { recursive: true, force: true });
    directories.clear();
  });
  async function setup() {
    const harness = await createWikiImportHarness(getDatabase());
    directories.add(harness.filesDirectory);
    return harness;
  }

  it("maps the required example collection to pages, parent edges and explicit title origins", async () => {
    const { planner, actor } = await setup();
    const result = importPlan(await planner.plan(actor, examples));
    expect(result).toMatchObject({
      valid: true,
      contentComplete: true,
      errors: [],
      conflicts: [],
      assets: [],
      externalEffects: [],
    });
    expect(result.pages).toHaveLength(6);
    expect(result.pages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "directory:guide",
          title: "Guide",
          titleSource: "h1",
          sourceKeys: ["guide/README.md"],
          level: 1,
          action: "create",
          contentBytes: 8,
        }),
        expect.objectContaining({
          key: "directory:bare",
          title: "bare",
          titleSource: "directory",
          sourceKeys: [],
          level: 1,
          contentBytes: 0,
        }),
        expect.objectContaining({
          key: "file:bare/without.md",
          title: "without",
          titleSource: "filename",
          sourceKeys: ["bare/without.md"],
          level: 2,
        }),
        expect.objectContaining({
          key: "file:intro.md",
          title: "Introduction",
          titleSource: "h1",
          sourceKeys: ["intro.md"],
          level: 1,
        }),
        expect.objectContaining({
          key: "file:plain.md",
          title: "plain",
          titleSource: "filename",
        }),
        expect.objectContaining({
          key: "file:explicit.md",
          title: "Chosen",
          titleSource: "explicit",
        }),
      ]),
    );
    expect(result.edges).toEqual(
      expect.arrayContaining([
        {
          childKey: "directory:guide",
          parent: { kind: "existing", pageId: null },
        },
        {
          childKey: "directory:bare",
          parent: { kind: "existing", pageId: null },
        },
        {
          childKey: "file:bare/without.md",
          parent: { kind: "planned", key: "directory:bare" },
        },
        {
          childKey: "file:intro.md",
          parent: { kind: "existing", pageId: null },
        },
      ]),
    );
    expect(importPlan(await planner.plan(actor, examples)).fingerprint).toBe(
      result.fingerprint,
    );
  });

  it("uses root README and nested index as group content without modifying the selected existing parent", async () => {
    const { planner, actor, service, owner } = await setup();
    const parent = await service.create(
      owner,
      pageInput({ scope: "project", projectId: "alpha", title: "Existing" }),
    );
    const request = importRequest(
      [
        { sourceKey: "README.md", content: "# Handbook" },
        { sourceKey: "plain.md", content: "Body" },
        { sourceKey: "topics/index.md", content: "# Topics" },
        { sourceKey: "topics/item.md", content: "Body" },
      ],
      { parentId: parent.id },
    );
    const result = importPlan(await planner.plan(actor, request));
    expect(result.valid).toBe(true);
    expect(result.pages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "directory:.",
          title: "Handbook",
          sourceKeys: ["README.md"],
          isDirectory: true,
          level: 2,
        }),
        expect.objectContaining({
          key: "directory:topics",
          title: "Topics",
          sourceKeys: ["topics/index.md"],
          level: 3,
        }),
        expect.objectContaining({ key: "file:topics/item.md", level: 4 }),
      ]),
    );
    expect(result.edges).toEqual(
      expect.arrayContaining([
        {
          childKey: "directory:.",
          parent: { kind: "existing", pageId: parent.id },
        },
        {
          childKey: "file:plain.md",
          parent: { kind: "planned", key: "directory:." },
        },
        {
          childKey: "directory:topics",
          parent: { kind: "planned", key: "directory:." },
        },
      ]),
    );
  });

  it("detects cross-package title conflicts with the complete index, including the index-only first call", async () => {
    const { planner, actor } = await setup();
    const full = importRequest([
      { sourceKey: "one.md", title: "Same", content: "One" },
      { sourceKey: "two.md", title: "Same", content: "Two" },
    ]);
    for (const files of [
      [],
      [full.manifest.files[0]],
      [full.manifest.files[1]],
    ]) {
      const request = {
        ...full,
        manifest: {
          ...full.manifest,
          files: files.filter((file) => file !== undefined),
        },
      };
      const result = importPlan(await planner.plan(actor, request));
      expect(result).toMatchObject({ valid: false, contentComplete: false });
      expect(result.conflicts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "CONFLICT",
            reason: "title_conflict",
            sourceKeys: expect.arrayContaining(["one.md", "two.md"]),
          }),
        ]),
      );
      expect(result.pages.every((page) => page.action === "conflict")).toBe(
        true,
      );
    }
    const indexOnly = importPlan(
      await planner.plan(actor, {
        ...examples,
        manifest: { ...examples.manifest, files: [] },
      }),
    );
    expect(indexOnly).toMatchObject({ valid: true, contentComplete: false });
    expect(
      indexOnly.pages.find((page) => page.key === "file:plain.md")
        ?.contentBytes,
    ).toBeNull();
  });

  it("reports duplicate source/content keys and ambiguous README/index groups as conflicts", async () => {
    const { planner, actor } = await setup();
    const single = importRequest();
    const duplicates = importPlan(
      await planner.plan(actor, {
        ...single,
        manifest: {
          ...single.manifest,
          index: [...single.manifest.index, ...single.manifest.index],
          files: [...single.manifest.files, ...single.manifest.files],
        },
      }),
    );
    expect(duplicates.conflicts.map((issue) => issue.reason)).toEqual([
      "duplicate_source",
      "duplicate_content",
    ]);
    expect(duplicates.pages[0]?.action).toBe("conflict");
    const grouped = importPlan(
      await planner.plan(
        actor,
        importRequest([
          { sourceKey: "guide/README.md", content: "# Guide" },
          { sourceKey: "guide/index.md", content: "# Index" },
          { sourceKey: "guide/item.md", content: "Body" },
        ]),
      ),
    );
    expect(grouped.conflicts).toContainEqual({
      code: "CONFLICT",
      reason: "group_content_conflict",
      sourceKeys: ["guide/README.md", "guide/index.md"],
      targetKey: "directory:guide",
    });
    expect(
      grouped.pages.find((page) => page.key === "file:guide/item.md")?.action,
    ).toBe("blocked");
  });

  it("rejects unsafe/non-Markdown paths visibly and creates no flattened substitutes", async () => {
    const { planner, actor } = await setup();
    const sourceKeys = [
      "/absolute.md",
      "../escape.md",
      "guide/../escape.md",
      "not.txt",
    ];
    const result = importPlan(
      await planner.plan(
        actor,
        importRequest(
          sourceKeys.map((sourceKey) => ({
            sourceKey,
            content: "Body",
            title: "Title",
          })),
        ),
      ),
    );
    expect(result.valid).toBe(false);
    expect(result.pages).toEqual([]);
    for (const sourceKey of sourceKeys)
      expect(result.errors).toContainEqual({
        code: "INVALID_REQUEST",
        reason: "invalid_path",
        sourceKeys: [sourceKey],
      });
  });

  it("validates loaded H1/explicit title metadata, unloaded filename claims and package membership", async () => {
    const { planner, actor } = await setup();
    const request = importRequest([{ sourceKey: "a.md", content: "# Actual" }]);
    const result = importPlan(
      await planner.plan(actor, {
        ...request,
        manifest: {
          ...request.manifest,
          index: [
            { sourceKey: "a.md", title: "Claimed", titleSource: "h1" },
            { sourceKey: "b.md", title: "Wrong", titleSource: "filename" },
          ],
          files: [
            ...request.manifest.files,
            { sourceKey: "extra.md", content: "Body" },
          ],
        },
      }),
    );
    expect(result.errors.map((issue) => issue.reason)).toEqual([
      "missing_index_entry",
      "index_mismatch",
      "index_mismatch",
    ]);
    expect(result.pages.every((page) => page.action === "invalid")).toBe(true);
    const origin = importPlan(
      await planner.plan(actor, {
        ...request,
        manifest: {
          ...request.manifest,
          index: [
            { sourceKey: "a.md", title: "Actual", titleSource: "explicit" },
          ],
        },
      }),
    );
    expect(origin.errors).toContainEqual({
      code: "INVALID_REQUEST",
      reason: "index_mismatch",
      sourceKeys: ["a.md"],
    });
  });

  it("applies wiki title limits to empty/long source titles and generated directory names", async () => {
    const { planner, actor } = await setup();
    const result = importPlan(
      await planner.plan(
        actor,
        importRequest([
          { sourceKey: "empty.md", content: "#" },
          { sourceKey: "explicit.md", content: "Body", title: "x".repeat(201) },
          { sourceKey: "a".repeat(201) + "/child.md", content: "Body" },
        ]),
      ),
    );
    expect(
      result.errors.filter((issue) => issue.reason === "invalid_title"),
    ).toHaveLength(3);
    expect(result.errors.every((issue) => issue.limit === 200)).toBe(true);
  });

  it("accepts ten source levels and rejects eleven without truncating the path or flattening the tree", async () => {
    const { planner, actor } = await setup();
    const ten = "g/".repeat(9) + "leaf.md";
    const eleven = "g/".repeat(10) + "leaf.md";
    const valid = importPlan(
      await planner.plan(
        actor,
        importRequest([{ sourceKey: ten, content: "Body" }]),
      ),
    );
    expect(valid.valid).toBe(true);
    expect(valid.pages.find((page) => page.key === `file:${ten}`)?.level).toBe(
      10,
    );
    const invalid = importPlan(
      await planner.plan(
        actor,
        importRequest([{ sourceKey: eleven, content: "Body" }]),
      ),
    );
    expect(invalid.errors).toContainEqual({
      code: "INVALID_REQUEST",
      reason: "tree_too_deep",
      sourceKeys: [eleven],
      limit: 10,
    });
    expect(invalid.pages).toEqual([]);
  });

  it("counts every existing ancestor and planned group in the depth, preserving invalid edges", async () => {
    const { planner, actor, service, owner } = await setup();
    let parentId: string | null = null;
    for (let level = 1; level <= 9; level++) {
      const parent = await service.create(
        owner,
        pageInput({
          title: `Level ${level}`,
          parentId,
          scope: "project",
          projectId: "alpha",
        }),
      );
      parentId = parent.id;
    }
    const valid = importPlan(
      await planner.plan(actor, importRequest(undefined, { parentId })),
    );
    expect(valid.pages[0]).toMatchObject({ level: 10, action: "create" });
    const request = importRequest(
      [{ sourceKey: "g/page.md", content: "Body" }],
      { parentId },
    );
    const invalid = importPlan(await planner.plan(actor, request));
    expect(
      invalid.pages.find((page) => page.key === "directory:g"),
    ).toMatchObject({ level: 10, action: "create" });
    expect(
      invalid.pages.find((page) => page.key === "file:g/page.md"),
    ).toMatchObject({ level: 11, action: "invalid" });
    expect(invalid.edges).toContainEqual({
      childKey: "file:g/page.md",
      parent: { kind: "planned", key: "directory:g" },
    });
    expect(invalid.errors).toContainEqual(
      expect.objectContaining({
        reason: "tree_too_deep",
        limit: WIKI_LIMITS.treeDepth,
      }),
    );
    const rootGroup = importPlan(
      await planner.plan(
        actor,
        importRequest(
          [
            { sourceKey: "README.md", content: "# Group" },
            { sourceKey: "child.md", content: "Body" },
          ],
          { parentId },
        ),
      ),
    );
    expect(
      rootGroup.pages.find((page) => page.key === "file:child.md"),
    ).toMatchObject({ level: 11, action: "invalid" });
  });

  it("checks all visible direct target children beyond the A9.5 tree window and blocks conflicting groups", async () => {
    const { planner, actor, database, service, owner } = await setup();
    await database.execute(
      "INSERT INTO wiki_pages (id, project_id, title, owner_id, author_id) SELECT 'sibling-' || CAST(range AS VARCHAR), 'alpha', 'Other ' || CAST(range AS VARCHAR), 'owner', 'owner' FROM range(101);",
    );
    const existing = await service.create(
      owner,
      pageInput({ scope: "project", projectId: "alpha", title: "guide" }),
    );
    const result = importPlan(
      await planner.plan(
        actor,
        importRequest([{ sourceKey: "guide/child.md", content: "Body" }]),
      ),
    );
    expect(result.conflicts).toContainEqual(
      expect.objectContaining({
        reason: "title_conflict",
        targetKey: "directory:guide",
        existingPageIds: [existing.id],
      }),
    );
    expect(
      result.pages.find((page) => page.key === "file:guide/child.md")?.action,
    ).toBe("blocked");
    expect(result.valid).toBe(false);
  });

  it("allows same titles below different parents and catches file/directory title collisions", async () => {
    const { planner, actor } = await setup();
    const different = importPlan(
      await planner.plan(
        actor,
        importRequest([
          { sourceKey: "one/same.md", content: "Body" },
          { sourceKey: "two/same.md", content: "Body" },
        ]),
      ),
    );
    expect(different.valid).toBe(true);
    const collision = importPlan(
      await planner.plan(
        actor,
        importRequest([
          { sourceKey: "guide.md", content: "Body" },
          { sourceKey: "guide/child.md", content: "Body" },
        ]),
      ),
    );
    expect(
      collision.conflicts.filter((issue) => issue.reason === "title_conflict"),
    ).toHaveLength(2);
  });

  it("only mentions relative assets in the current package and makes no external request", async () => {
    const { planner, actor } = await setup();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const request = importRequest([
      {
        sourceKey: "a.md",
        content: "![image](images/a.png) [PDF](files/a.pdf) [page](b.md)",
      },
      { sourceKey: "b.md", content: "![other](b.png)" },
    ]);
    const result = importPlan(
      await planner.plan(actor, {
        ...request,
        manifest: {
          ...request.manifest,
          files: request.manifest.files.slice(0, 1),
        },
      }),
    );
    expect(result.assets).toEqual([
      { sourceKey: "a.md", url: "images/a.png", kind: "image" },
      { sourceKey: "a.md", url: "files/a.pdf", kind: "file" },
    ]);
    expect(result.contentComplete).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("normalizes generated directory titles and detects both manifest and existing sibling conflicts after normalization", async () => {
    const { planner, actor, service, owner } = await setup();
    const existing = await service.create(
      owner,
      pageInput({ scope: "project", projectId: "alpha", title: "one two" }),
    );
    const result = importPlan(
      await planner.plan(
        actor,
        importRequest([
          { sourceKey: "one  two/a.md", content: "Body" },
          { sourceKey: "one two/b.md", content: "Body" },
        ]),
      ),
    );
    const groups = result.pages.filter((page) => page.isDirectory);
    expect(groups.map((page) => page.title)).toEqual(["one two", "one two"]);
    expect(groups.every((page) => page.action === "conflict")).toBe(true);
    expect(result.conflicts).toHaveLength(2);
    expect(
      result.conflicts.every(
        (issue) =>
          issue.reason === "title_conflict" &&
          issue.existingPageIds?.includes(existing.id),
      ),
    ).toBe(true);
    expect(
      result.pages
        .filter((page) => !page.isDirectory)
        .every((page) => page.action === "blocked"),
    ).toBe(true);
  });

  it("rejects template parents visibly and propagates database failures without disguising them", async () => {
    const { planner, actor, service, owner, repository } = await setup();
    const template = await service.create(
      owner,
      pageInput({ scope: "project", projectId: "alpha", isTemplate: true }),
    );
    const request = importRequest(undefined, { parentId: template.id });
    const result = importPlan(await planner.plan(actor, request));
    expect(result.errors).toContainEqual({
      code: "INVALID_REQUEST",
      reason: "invalid_parent",
      sourceKeys: [],
    });
    vi.spyOn(repository.pages, "findVisible").mockRejectedValue(
      new Error("database offline"),
    );
    await expect(planner.plan(actor, request)).rejects.toThrow(
      "database offline",
    );
  });

  it("bounds the complete preview in serialized UTF-8 bytes with an explicit response limit", async () => {
    const { planner, actor, repository } = await setup();
    vi.spyOn(repository.pages, "listProjectChildren").mockResolvedValue(
      Array.from({ length: 6000 }, (_, index) => ({
        id: "x".repeat(200) + index,
        title: "new",
        icon: null,
      })),
    );
    await expect(planner.plan(actor, importRequest())).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      status: 413,
      details: { constraint: "responseBytes", limit: 1_048_576 },
    });
  });

  it("plans the maximum index with ten levels per source within the unchanged response limit", async () => {
    const { planner, actor } = await setup();
    const request = importRequest(
      Array.from({ length: 128 }, (_, index) => ({
        sourceKey: `root-${index}/` + "g/".repeat(8) + "leaf.md",
        content: "Body",
      })),
    );
    const result = importPlan(
      await planner.plan(actor, {
        ...request,
        manifest: { ...request.manifest, files: [] },
      }),
    );
    expect(result).toMatchObject({
      valid: true,
      contentComplete: false,
      errors: [],
      conflicts: [],
    });
    expect(result.pages).toHaveLength(1280);
    expect(result.edges).toHaveLength(1280);
    expect(Math.max(...result.pages.map((page) => page.level))).toBe(10);
  });
});
