import { describe, expect, it } from "vitest";

import {
  canonicalStructuredManifest,
  isStructuredKey,
  readStructuredImportApply,
  readStructuredImportPlan,
  readStructuredManifest,
} from "@/backend/service/agents/StructuredImportManifestReader";

import {
  expectInvalidRequest,
  expectTooLarge,
} from "./operation-error-expectation";

import type { AgentStructuredManifest } from "@/definition/AgentStructuredImportManifest";

function tickets(count: number): unknown[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: "ticket",
    key: `t${index}`,
    project: "main",
    type: "task",
    title: `Ticket ${index}`,
  }));
}

function wikiPages(count: number, bytes: number): unknown[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: "wiki",
    key: `docs/page-${index}.md`,
    content: "x".repeat(bytes),
  }));
}

function read(fields: Record<string, unknown>): unknown {
  return readStructuredManifest({ version: "1", sources: [], ...fields });
}

describe("structured manifest size limits", () => {
  it("accepts 100 sources and refuses 101", () => {
    expect(read({ sources: tickets(100) })).toBeDefined();
    expectTooLarge(() => read({ sources: tickets(101) }), {
      constraint: "importSources",
      limit: 100,
    });
  });

  it("accepts 200 links and refuses 201", () => {
    const links = (count: number): unknown[] =>
      Array.from({ length: count }, (_, index) => ({
        type: "parent",
        from: `c${index}`,
        to: "p",
      }));
    expect(read({ links: links(200) })).toBeDefined();
    expectTooLarge(() => read({ links: links(201) }), {
      constraint: "importLinks",
      limit: 200,
    });
  });

  it("accepts 32 assets and refuses 33", () => {
    const assets = (count: number): unknown[] =>
      Array.from({ length: count }, (_, index) => ({
        path: `a${index}.png`,
        assetId: `id-${index}`,
      }));
    expect(read({ assets: assets(32) })).toBeDefined();
    expectTooLarge(() => read({ assets: assets(33) }), {
      constraint: "importAssets",
      limit: 32,
    });
  });

  it("accepts 32 wiki pages and refuses 33", () => {
    expect(read({ sources: wikiPages(32, 10) })).toBeDefined();
    expectTooLarge(() => read({ sources: wikiPages(33, 10) }), {
      constraint: "importFiles",
      limit: 32,
    });
  });

  it("limits one wiki page to 16384 bytes", () => {
    expect(read({ sources: wikiPages(1, 16_384) })).toBeDefined();
    expectTooLarge(() => read({ sources: wikiPages(1, 16_385) }), {
      constraint: "importFileBytes",
      limit: 16_384,
    });
  });

  it("limits all wiki pages together to 32768 bytes", () => {
    expect(read({ sources: wikiPages(2, 16_384) })).toBeDefined();
    expectTooLarge(() => read({ sources: wikiPages(3, 12_000) }), {
      constraint: "importContentBytes",
      limit: 32_768,
    });
  });

  it("counts bytes rather than characters for a page", () => {
    const page = { kind: "wiki", key: "a.md", content: "€".repeat(5_462) };
    expectTooLarge(() => read({ sources: [page] }), {
      constraint: "importFileBytes",
      limit: 16_384,
    });
  });

  it("limits wiki keys to 512 bytes, counted in bytes", () => {
    const key = (name: string): unknown[] => [
      { kind: "wiki", key: name, content: "" },
    ];
    expect(read({ sources: key(`${"a".repeat(509)}.md`) })).toBeDefined();
    expectTooLarge(() => read({ sources: key(`${"é".repeat(255)}.md`) }), {
      constraint: "importPathBytes",
      limit: 512,
    });
  });

  it("limits asset paths to 512 bytes", () => {
    const assets = [{ path: "a".repeat(513), assetId: "id" }];
    expectTooLarge(() => read({ assets }), {
      constraint: "importPathBytes",
      limit: 512,
    });
  });
});

describe("readStructuredImportPlan", () => {
  it("returns the validated manifest", () => {
    expect(
      readStructuredImportPlan({ manifest: { version: "1", sources: [] } }),
    ).toEqual({
      manifest: {
        version: "1",
        sources: [],
        links: [],
        assets: [],
        wiki: null,
      },
    });
  });

  it.each([
    ["no manifest", {}],
    [
      "an operation ID",
      { manifest: { version: "1", sources: [] }, operationId: "x" },
    ],
    ["an invalid manifest", { manifest: { version: "9", sources: [] } }],
    ["a non-object", "manifest"],
  ])("refuses %s", (_, input) => {
    expectInvalidRequest(() => readStructuredImportPlan(input));
  });

  it("refuses a request whose escaped JSON exceeds 64 KiB", () => {
    // Newlines pass the content limits as one byte but need two in JSON.
    const pages = wikiPages(2, 0).map((page) => ({
      ...(page as object),
      content: "\n".repeat(16_384),
    }));
    expectTooLarge(
      () =>
        readStructuredImportPlan({
          manifest: { version: "1", sources: pages },
        }),
      { constraint: "requestBytes", limit: 65_536 },
    );
  });
});

describe("readStructuredImportApply", () => {
  const apply = {
    operationId: "op-1",
    fingerprint: "a".repeat(64),
    manifest: { version: "1", sources: [] },
  };

  it("returns operation ID, fingerprint and manifest", () => {
    expect(readStructuredImportApply(apply)).toMatchObject({
      operationId: "op-1",
      fingerprint: "a".repeat(64),
      manifest: { version: "1", links: [] },
    });
  });

  it.each([
    ["an uppercase fingerprint", { fingerprint: "A".repeat(64) }],
    ["a short fingerprint", { fingerprint: "a".repeat(63) }],
    ["a non-hex fingerprint", { fingerprint: "g".repeat(64) }],
    ["a blank operation ID", { operationId: " " }],
    ["an overlong operation ID", { operationId: "o".repeat(201) }],
    ["a numeric operation ID", { operationId: 7 }],
    ["an invalid manifest", { manifest: { version: "1" } }],
    ["an unknown field", { dryRun: true }],
  ])("refuses %s", (_, change) => {
    expectInvalidRequest(() =>
      readStructuredImportApply({ ...apply, ...change }),
    );
  });

  it("accepts an operation ID of exactly 200 characters", () => {
    const operationId = "o".repeat(200);
    expect(readStructuredImportApply({ ...apply, operationId })).toMatchObject({
      operationId,
    });
  });
});

describe("isStructuredKey", () => {
  it.each(["PAGE-1", "a", "a.b_c-d", "0abc", "Milestone.1"])(
    "accepts %j",
    (key) => {
      expect(isStructuredKey(key)).toBe(true);
    },
  );

  it.each(["", "-a", ".a", "_a", "a b", "a/b", "ä", "a\n", "a:b"])(
    "rejects %j",
    (key) => {
      expect(isStructuredKey(key)).toBe(false);
    },
  );
});

describe("canonicalStructuredManifest", () => {
  const base: AgentStructuredManifest = {
    version: "1",
    sources: [
      { kind: "project", key: "main", projectId: "project-1" },
      { kind: "wiki", key: "a.md", content: "A" },
      { kind: "wiki", key: "b.md", content: "B" },
    ],
    links: [
      { type: "parent", from: "t2", to: "t1" },
      { type: "milestone", from: "t1", to: "m1" },
    ],
    assets: [
      { path: "a.png", assetId: "id-a" },
      { path: "b.png", assetId: "id-b" },
    ],
    wiki: { project: "main", parentId: null },
  };

  it("does not depend on the order of the lists", () => {
    const shuffled: AgentStructuredManifest = {
      ...base,
      sources: [...base.sources].reverse(),
      links: [...base.links].reverse(),
      assets: [...base.assets].reverse(),
    };
    expect(canonicalStructuredManifest(shuffled)).toBe(
      canonicalStructuredManifest(base),
    );
  });

  it("changes when the content of a page changes", () => {
    const changed: AgentStructuredManifest = {
      ...base,
      sources: [
        base.sources[0],
        { kind: "wiki", key: "a.md", content: "A changed" },
        base.sources[2],
      ],
    };
    expect(canonicalStructuredManifest(changed)).not.toBe(
      canonicalStructuredManifest(base),
    );
  });

  it("changes when the wiki target or an asset changes", () => {
    const moved: AgentStructuredManifest = {
      ...base,
      wiki: { project: "main", parentId: "page-1" },
    };
    const remapped: AgentStructuredManifest = {
      ...base,
      assets: [{ path: "a.png", assetId: "id-other" }, base.assets[1]],
    };
    const original = canonicalStructuredManifest(base);
    expect(canonicalStructuredManifest(moved)).not.toBe(original);
    expect(canonicalStructuredManifest(remapped)).not.toBe(original);
  });
});
