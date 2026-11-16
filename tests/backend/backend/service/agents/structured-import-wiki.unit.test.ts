import { expect, it } from "vitest";

import {
  buildStructuredWiki,
  readStructuredAssetMap,
  structuredWikiApplyInput,
} from "@/backend/service/agents/StructuredImportWiki";

import type { AgentStructuredManifest } from "@/definition/AgentStructuredImportManifest";

const MANIFEST: AgentStructuredManifest = {
  version: "1",
  links: [],
  wiki: { project: "project", parentId: null },
  assets: [{ path: "images/a.png", assetId: "asset" }],
  sources: [
    {
      kind: "wiki",
      key: "first.md",
      content: "# First\n\n![Image](images/a.png)",
    },
  ],
};

it("rejects invalid or duplicate asset paths without overwriting the first entry", () => {
  const result = readStructuredAssetMap({
    ...MANIFEST,
    assets: [
      ...MANIFEST.assets,
      { path: "../secret", assetId: "invalid" },
      { path: "images/a.png", assetId: "duplicate" },
      { path: "a//b", assetId: "empty-part" },
    ],
  });
  expect([...result.assets]).toEqual([["images/a.png", "asset"]]);
  expect(result.errors.map((error) => error.reason)).toEqual([
    "invalid_asset_path",
    "duplicate_asset_path",
    "invalid_asset_path",
  ]);
});

it("builds a wiki package and binds the staged asset to its source", () => {
  const assets = readStructuredAssetMap(MANIFEST).assets;
  const pack = buildStructuredWiki(
    MANIFEST,
    assets,
    new Map([["project", "project-id"]]),
  );
  if (!pack) throw new Error("Missing wiki package");
  expect(pack.request).toMatchObject({
    projectId: "project-id",
    parentId: null,
    manifest: { files: [{ sourceKey: "first.md" }] },
  });
  expect(pack.bindings).toEqual([
    { sourceKey: "first.md", assetIds: ["asset"] },
  ]);
  expect(pack.usage.get("asset")).toEqual(["first.md"]);
  expect(structuredWikiApplyInput(pack, "fingerprint")).toMatchObject({
    operationId: "structured",
    fingerprint: "fingerprint",
    projectId: "project-id",
    assets: pack.bindings,
  });
});

it("detects assets shared by multiple pages and handles a missing wiki target", () => {
  const manifest = {
    ...MANIFEST,
    sources: [
      ...MANIFEST.sources,
      {
        kind: "wiki" as const,
        key: "second.md",
        content: "# Second\n\n![Image](images/a.png)",
      },
    ],
  };
  const pack = buildStructuredWiki(
    manifest,
    readStructuredAssetMap(manifest).assets,
    new Map(),
  );
  expect(pack?.errors).toMatchObject([
    { reason: "asset_shared", keys: ["asset:asset", "first.md", "second.md"] },
  ]);
  expect(
    buildStructuredWiki({ ...MANIFEST, wiki: null }, new Map(), new Map()),
  ).toBeNull();
  expect(
    buildStructuredWiki({ ...MANIFEST, sources: [] }, new Map(), new Map()),
  ).toBeNull();
});
