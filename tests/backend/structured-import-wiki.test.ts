import { describe, expect, it } from "vitest";

import {
  failedStructuredItem,
  storedTargetId,
  toStructuredItem,
  StructuredStepBlockedError,
} from "@/backend/service/agents/StructuredImportItems";
import {
  buildStructuredWiki,
  readStructuredAssetMap,
  structuredWikiApplyInput,
} from "@/backend/service/agents/StructuredImportWiki";

import { structuredManifest } from "../helpers/structured-import";

import type { AgentImportItem } from "@/definition/AgentImportApply";
import type { StructuredStep } from "@/backend/service/agents/StructuredImportPlanner";

const step: StructuredStep = {
  kind: "ticket",
  name: "t",
  key: "ticket:t",
  project: "project",
  label: "T",
};
const wiki: AgentImportItem = {
  sourceKey: "a.md",
  targetKey: "file:a.md",
  action: "created",
  pageId: "page",
  link: "/wiki/page",
  assets: [],
  errorCode: null,
};

describe("structured stored outcomes", () => {
  it("preserves structured records and converts wiki outcomes without losing assets or errors", () => {
    const structured = failedStructuredItem(step, "CONFLICT", "blocked");
    expect(structured).toMatchObject({
      action: "conflict",
      targetId: null,
      errorCode: "CONFLICT",
      reason: "blocked",
    });
    expect(toStructuredItem(structured)).toBe(structured);
    expect(toStructuredItem(wiki)).toEqual({
      kind: "wiki",
      sourceKey: "a.md",
      targetKey: "file:a.md",
      action: "created",
      targetId: "page",
      key: null,
      link: "/wiki/page",
      parentId: null,
      milestoneId: null,
      assets: [],
      reason: null,
      errorCode: null,
    });
    expect(storedTargetId(wiki)).toBe("page");
    expect(storedTargetId({ ...structured, targetId: "existing" })).toBe(
      "existing",
    );
    expect(storedTargetId(null)).toBeNull();
    expect(
      storedTargetId(failedStructuredItem(step, "FORBIDDEN", null)),
    ).toBeNull();
    expect(new StructuredStepBlockedError().message).toContain("unavailable");
  });
});

describe("structured wiki package", () => {
  it.each([
    "",
    "a\\b.png",
    "a\u0000.png",
    "e\u0301.png",
    "a//b.png",
    "./b.png",
    "a/../b.png",
  ])("rejects unsafe asset paths %s", (path) => {
    expect(
      readStructuredAssetMap(
        structuredManifest({ assets: [{ path, assetId: "id" }] }),
      ),
    ).toEqual({
      assets: new Map(),
      errors: [
        {
          code: "INVALID_REQUEST",
          reason: "invalid_asset_path",
          keys: ["asset:id"],
        },
      ],
    });
  });

  it("indexes clean paths and diagnoses duplicates without replacing the first ID", () => {
    const result = readStructuredAssetMap(
      structuredManifest({
        assets: [
          { path: "image.png", assetId: "first" },
          { path: "image.png", assetId: "second" },
        ],
      }),
    );
    expect(result.assets).toEqual(new Map([["image.png", "first"]]));
    expect(result.errors).toEqual([
      {
        code: "INVALID_REQUEST",
        reason: "duplicate_asset_path",
        keys: ["asset:second"],
      },
    ]);
  });

  it("rewrites sources before deriving titles, deduplicates bindings and diagnoses shared assets", () => {
    const manifest = structuredManifest({
      sources: [
        {
          kind: "wiki",
          key: "a.md",
          content:
            "# A\n\n![a](image.png) ![again](image.png) [missing](no.pdf)",
        },
        {
          kind: "wiki",
          key: "b.md",
          content: "B ![a](image.png)",
          title: "Explicit",
        },
      ],
    });
    const pack = buildStructuredWiki(
      manifest,
      new Map([["image.png", "asset"]]),
      new Map(),
    );
    if (!pack) throw new Error("Expected wiki package.");
    expect(pack.projectId).toBe("");
    expect(pack.request.manifest.files).toEqual([
      {
        sourceKey: "a.md",
        content:
          "# A\n\n![a](/agent-assets/asset) ![again](/agent-assets/asset) [missing](no.pdf)",
      },
      {
        sourceKey: "b.md",
        content: "B ![a](/agent-assets/asset)",
        title: "Explicit",
      },
    ]);
    expect(pack.bindings).toEqual([
      { sourceKey: "a.md", assetIds: ["asset"] },
      { sourceKey: "b.md", assetIds: ["asset"] },
    ]);
    expect(pack.errors).toEqual([
      {
        code: "INVALID_REQUEST",
        reason: "asset_shared",
        keys: ["asset:asset", "a.md", "b.md"],
      },
    ]);
    expect(structuredWikiApplyInput(pack, "fingerprint")).toEqual({
      operationId: "structured",
      fingerprint: "fingerprint",
      projectId: "",
      parentId: null,
      manifest: pack.request.manifest,
      assets: pack.bindings,
    });
  });

  it("produces no package without sources or target", () => {
    expect(
      buildStructuredWiki(
        structuredManifest({ sources: [] }),
        new Map(),
        new Map(),
      ),
    ).toBeNull();
    expect(
      buildStructuredWiki(
        structuredManifest({ wiki: null }),
        new Map(),
        new Map(),
      ),
    ).toBeNull();
  });
});
