import { describe, expect, it } from "vitest";

import {
  canonicalStructuredManifest,
  isStructuredKey,
  readStructuredImportApply,
  readStructuredImportPlan,
  readStructuredManifest,
} from "@/backend/service/agents/StructuredImportManifestReader";

const project = { kind: "project", key: "p", projectId: "p1" };
const manifest = { version: "1", sources: [project] };
const request = { operationId: "apply", fingerprint: "a".repeat(64), manifest };

function withSource(source: unknown): unknown {
  return { ...manifest, sources: [project, source] };
}

describe("structured manifest boundaries", () => {
  it("fills optional fields, retains exact text and defaults a single project", () => {
    const parsed = readStructuredManifest({
      ...manifest,
      sources: [
        project,
        {
          kind: "milestone",
          key: "m",
          name: " Release ",
          startAt: "2026-10-11",
          dueAt: null,
        },
        { kind: "ticket", key: "t", type: "task", title: " Ticket " },
        {
          kind: "wiki",
          key: "a.md",
          content: "\ufeff# Exact\r\n",
          title: " Explicit ",
        },
      ],
      links: [
        { type: "parent", from: "t", to: "parent" },
        { type: "milestone", from: "t", to: "m" },
        { type: "dependency", from: "m", to: "next", linkType: "relates_to" },
      ],
      assets: [{ path: "image.png", assetId: "asset" }],
      wiki: { parentId: "parent" },
    });
    expect(parsed.sources).toEqual([
      project,
      {
        kind: "milestone",
        key: "m",
        project: "p",
        name: " Release ",
        description: "",
        startAt: "2026-10-11",
        dueAt: null,
      },
      {
        kind: "ticket",
        key: "t",
        project: "p",
        type: "task",
        title: " Ticket ",
        description: "",
      },
      {
        kind: "wiki",
        key: "a.md",
        content: "\ufeff# Exact\r\n",
        title: " Explicit ",
      },
    ]);
    expect(parsed.wiki).toEqual({ project: "p", parentId: "parent" });
    expect(readStructuredImportPlan({ manifest }).manifest).toEqual(
      readStructuredManifest(manifest),
    );
    expect(readStructuredImportApply(request)).toEqual({
      ...request,
      manifest: readStructuredManifest(manifest),
    });
  });

  it("does not guess among multiple projects or when no project exists", () => {
    for (const projects of [[], [project, { ...project, key: "other" }]]) {
      const parsed = readStructuredManifest({
        version: "1",
        sources: [
          ...projects,
          { kind: "ticket", key: "t", type: "task", title: "T" },
          {
            kind: "milestone",
            key: "m",
            name: "M",
            description: "Body",
            startAt: null,
            dueAt: "2026-10-12",
          },
          { kind: "wiki", key: "a.md", content: "Body" },
        ],
        wiki: { parentId: null },
      });
      expect(parsed.wiki).toEqual({ project: "", parentId: null });
      expect(
        parsed.sources.find((source) => source.kind === "ticket"),
      ).toMatchObject({ project: "" });
    }
    expect(readStructuredManifest({ ...manifest, wiki: null }).wiki).toBeNull();
    expect(
      readStructuredManifest({
        ...manifest,
        wiki: { project: "explicit", parentId: null },
      }).wiki?.project,
    ).toBe("explicit");
  });

  it.each([
    null,
    [],
    "text",
    {},
    { ...manifest, extra: true },
    { ...manifest, version: "2" },
    { ...manifest, sources: null },
    withSource(null),
    withSource([]),
    withSource({}),
    withSource({ kind: "unknown" }),
    withSource({ ...project, extra: 1 }),
    withSource({ ...project, key: 1 }),
    withSource({ ...project, key: "x".repeat(101) }),
    withSource({ ...project, projectId: " " }),
    withSource({ ...project, projectId: "x".repeat(201) }),
    withSource({ kind: "ticket", key: "t", type: "unknown", title: "T" }),
    withSource({ kind: "ticket", key: "t", type: "task", title: 1 }),
    withSource({ kind: "milestone", key: "m", name: "M", startAt: 1 }),
    { ...manifest, links: null },
    { ...manifest, links: [null] },
    {
      ...manifest,
      links: [{ type: "dependency", from: "a", to: "b", linkType: "unknown" }],
    },
    { ...manifest, links: [{ type: "unknown", from: "a", to: "b" }] },
    {
      ...manifest,
      links: [{ type: "parent", from: "a", to: "b", linkType: "blocks" }],
    },
    { ...manifest, assets: [{ path: 1, assetId: "id" }] },
    { ...manifest, wiki: {} },
    { ...manifest, wiki: [] },
  ])("rejects malformed input before any persistence read: %j", (input) => {
    expect(() => readStructuredManifest(input)).toThrow(
      expect.objectContaining({ code: "INVALID_REQUEST" }),
    );
  });

  it.each([
    { operationId: null },
    { operationId: " " },
    { operationId: "x".repeat(201) },
    { fingerprint: null },
    { fingerprint: "A".repeat(64) },
    { fingerprint: "a".repeat(63) },
    { extra: true },
  ])("rejects invalid confirmation metadata %j", (overrides) => {
    expect(() =>
      readStructuredImportApply({ ...request, ...overrides }),
    ).toThrow(expect.objectContaining({ code: "INVALID_REQUEST" }));
  });

  it.each([
    [
      { ...manifest, sources: Array.from({ length: 101 }, () => project) },
      "importSources",
      100,
    ],
    [
      { ...manifest, links: Array.from({ length: 201 }, () => ({})) },
      "importLinks",
      200,
    ],
    [
      { ...manifest, assets: Array.from({ length: 33 }, () => ({})) },
      "importAssets",
      32,
    ],
    [
      withSource({ kind: "wiki", key: "a".repeat(513), content: "" }),
      "importPathBytes",
      512,
    ],
    [
      withSource({ kind: "wiki", key: "a.md", content: "ä".repeat(8193) }),
      "importFileBytes",
      16384,
    ],
    [
      {
        ...manifest,
        sources: Array.from({ length: 33 }, () => ({
          kind: "wiki",
          key: "a.md",
          content: "",
        })),
      },
      "importFiles",
      32,
    ],
    [
      {
        ...manifest,
        sources: Array.from({ length: 3 }, () => ({
          kind: "wiki",
          key: "a.md",
          content: "x".repeat(16384),
        })),
      },
      "importContentBytes",
      32768,
    ],
  ])(
    "reports the exact transport constraint %s",
    (input, constraint, limit) => {
      expect(() => readStructuredManifest(input)).toThrow(
        expect.objectContaining({
          code: "PAYLOAD_TOO_LARGE",
          details: { constraint, limit },
        }),
      );
    },
  );

  it("bounds normalized plan and apply envelopes", () => {
    const oversized = {
      ...manifest,
      sources: [
        project,
        {
          kind: "ticket",
          key: "t",
          title: "T",
          type: "task",
          description: "x".repeat(65536),
        },
      ],
    };
    for (const read of [
      () => readStructuredImportPlan({ manifest: oversized }),
      () => readStructuredImportApply({ ...request, manifest: oversized }),
    ])
      expect(read).toThrow(
        expect.objectContaining({
          code: "PAYLOAD_TOO_LARGE",
          details: { constraint: "requestBytes", limit: 65536 },
        }),
      );
  });

  it("canonicalizes every list but binds content and placement", () => {
    const parsed = readStructuredManifest({
      ...manifest,
      sources: [project, { kind: "wiki", key: "a.md", content: "A" }],
      links: [
        { type: "parent", from: "b", to: "a" },
        { type: "milestone", from: "b", to: "m" },
      ],
      assets: [
        { path: "a.png", assetId: "a" },
        { path: "b.png", assetId: "b" },
      ],
    });
    expect(
      canonicalStructuredManifest({
        ...parsed,
        sources: [...parsed.sources].reverse(),
        links: [...parsed.links].reverse(),
        assets: [...parsed.assets].reverse(),
      }),
    ).toBe(canonicalStructuredManifest(parsed));
    expect(
      canonicalStructuredManifest({
        ...parsed,
        wiki: { project: "p", parentId: "different" },
      }),
    ).not.toBe(canonicalStructuredManifest(parsed));
    expect(isStructuredKey("valid-key_1.2")).toBe(true);
    expect(isStructuredKey("wiki:path.md")).toBe(false);
  });
});
