import { expect, it } from "vitest";

import {
  buildStructuredWiki,
  readStructuredAssetMap,
  structuredWikiApplyInput,
} from "@/backend/service/agents/StructuredImportWiki";

import { manifestOf, wikiSource } from "./structured-manifest-fixture";

it("rejects unclean and duplicate asset paths while retaining valid entries", () => {
  const manifest = manifestOf([], {
    assets: [
      { path: "docs/a.png", assetId: "a" },
      { path: "docs/a.png", assetId: "duplicate" },
      ...["", "../a", "a//b", "a\\b", "cafe\u0301.png", "a/./b"].map(
        (path, index) => ({ path, assetId: `bad-${index}` }),
      ),
    ],
  });
  const result = readStructuredAssetMap(manifest);
  expect([...result.assets]).toEqual([["docs/a.png", "a"]]);
  expect(result.errors).toEqual([
    {
      code: "INVALID_REQUEST",
      reason: "duplicate_asset_path",
      keys: ["asset:duplicate"],
    },
    ...Array.from({ length: 6 }, (_, index) => ({
      code: "INVALID_REQUEST",
      reason: "invalid_asset_path",
      keys: [`asset:bad-${index}`],
    })),
  ]);
});

it("returns no package without pages or without a target", () => {
  const target = { project: "main", parentId: null };
  expect(
    buildStructuredWiki(manifestOf([], { wiki: target }), new Map(), new Map()),
  ).toBeNull();
  expect(
    buildStructuredWiki(manifestOf([wikiSource("a.md")]), new Map(), new Map()),
  ).toBeNull();
});

it("rewrites links, deduplicates bindings and reports assets shared across pages", () => {
  const manifest = manifestOf(
    [
      wikiSource("docs/a.md", "# First\n![A](img.png) ![Again](img.png)"),
      wikiSource("docs/b.md", "[File](img.png)", "Second"),
    ],
    { wiki: { project: "main", parentId: "parent" } },
  );
  const pack = buildStructuredWiki(
    manifest,
    new Map([["docs/img.png", "asset-1"]]),
    new Map([["main", "project-1"]]),
  );
  expect(pack).not.toBeNull();
  if (!pack) throw new Error("Expected wiki package");
  expect(pack.request).toEqual({
    projectId: "project-1",
    parentId: "parent",
    manifest: {
      version: "1",
      index: [
        { sourceKey: "docs/a.md", title: "First", titleSource: "h1" },
        { sourceKey: "docs/b.md", title: "Second", titleSource: "explicit" },
      ],
      files: [
        {
          sourceKey: "docs/a.md",
          content:
            "# First\n![A](/agent-assets/asset-1) ![Again](/agent-assets/asset-1)",
        },
        {
          sourceKey: "docs/b.md",
          content: "[File](/agent-assets/asset-1)",
          title: "Second",
        },
      ],
    },
  });
  expect(pack.bindings).toEqual([
    { sourceKey: "docs/a.md", assetIds: ["asset-1"] },
    { sourceKey: "docs/b.md", assetIds: ["asset-1"] },
  ]);
  expect([...pack.usage]).toEqual([["asset-1", ["docs/a.md", "docs/b.md"]]]);
  expect(pack.links).toHaveLength(2);
  expect(pack.errors).toEqual([
    {
      code: "INVALID_REQUEST",
      reason: "asset_shared",
      keys: ["asset:asset-1", "docs/a.md", "docs/b.md"],
    },
  ]);
  expect(structuredWikiApplyInput(pack, "fingerprint")).toEqual({
    operationId: "structured",
    fingerprint: "fingerprint",
    projectId: "project-1",
    parentId: "parent",
    manifest: pack.request.manifest,
    assets: pack.bindings,
  });
});
