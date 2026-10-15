import { describe, expect, it } from "vitest";

import { readStructuredManifest } from "@/backend/service/agents/StructuredImportManifestReader";

import { expectInvalidRequest } from "./operation-error-expectation";

const PROJECT = { kind: "project", key: "main", projectId: "project-1" };
const MILESTONE = {
  kind: "milestone",
  key: "beta",
  project: "main",
  name: "Beta",
};
const TICKET = {
  kind: "ticket",
  key: "t1",
  project: "main",
  type: "task",
  title: "Write docs",
};

function manifest(fields: Record<string, unknown> = {}): unknown {
  return { version: "1", sources: [], ...fields };
}

describe("readStructuredManifest", () => {
  it("reads an empty manifest with every list defaulted", () => {
    expect(readStructuredManifest(manifest())).toEqual({
      version: "1",
      sources: [],
      links: [],
      assets: [],
      wiki: null,
    });
  });

  it("reads every kind of source with its defaults", () => {
    const result = readStructuredManifest(
      manifest({
        sources: [PROJECT, MILESTONE, TICKET],
      }),
    );
    expect(result.sources).toEqual([
      PROJECT,
      {
        ...MILESTONE,
        description: "",
        startAt: null,
        dueAt: null,
      },
      { ...TICKET, description: "" },
    ]);
  });

  it("reads wiki sources with an optional title", () => {
    const result = readStructuredManifest(
      manifest({
        sources: [
          { kind: "wiki", key: "docs/a.md", content: "# A" },
          { kind: "wiki", key: "docs/b.md", content: "B", title: "Bee" },
        ],
      }),
    );
    expect(result.sources).toEqual([
      { kind: "wiki", key: "docs/a.md", content: "# A" },
      { kind: "wiki", key: "docs/b.md", content: "B", title: "Bee" },
    ]);
  });

  it("reads links of all three types", () => {
    const result = readStructuredManifest(
      manifest({
        links: [
          { type: "parent", from: "t2", to: "t1" },
          { type: "milestone", from: "t1", to: "beta" },
          { type: "dependency", from: "a", to: "b", linkType: "blocks" },
        ],
      }),
    );
    expect(result.links).toEqual([
      { type: "parent", from: "t2", to: "t1" },
      { type: "milestone", from: "t1", to: "beta" },
      { type: "dependency", from: "a", to: "b", linkType: "blocks" },
    ]);
  });

  it("reads asset mappings", () => {
    const result = readStructuredManifest(
      manifest({ assets: [{ path: "img/a.png", assetId: "asset-1" }] }),
    );
    expect(result.assets).toEqual([{ path: "img/a.png", assetId: "asset-1" }]);
  });
});

describe("readStructuredManifest default project", () => {
  const withProjects = (...keys: string[]): unknown =>
    manifest({
      sources: [
        ...keys.map((key) => ({
          kind: "project",
          key,
          projectId: `id-${key}`,
        })),
        { ...TICKET, project: undefined },
        { ...MILESTONE, key: "m2", project: "" },
      ],
      wiki: { parentId: null },
    });

  it("fills the project of tickets, milestones and wiki when exactly one is named", () => {
    const result = readStructuredManifest(withProjects("main"));
    const ticket = result.sources.find((source) => source.kind === "ticket");
    const milestone = result.sources.find(
      (source) => source.kind === "milestone",
    );
    expect(ticket).toMatchObject({ project: "main" });
    expect(milestone).toMatchObject({ project: "main" });
    expect(result.wiki).toEqual({ project: "main", parentId: null });
  });

  it("leaves the project open when two projects are named", () => {
    const result = readStructuredManifest(withProjects("main", "other"));
    const ticket = result.sources.find((source) => source.kind === "ticket");
    expect(ticket).toMatchObject({ project: "" });
    expect(result.wiki).toEqual({ project: "", parentId: null });
  });

  it("leaves the project open when no project is named", () => {
    const result = readStructuredManifest(withProjects());
    expect(result.wiki).toEqual({ project: "", parentId: null });
  });

  it("keeps an explicit project even when exactly one project exists", () => {
    const result = readStructuredManifest(
      manifest({
        sources: [PROJECT, { ...TICKET, project: "elsewhere" }],
        wiki: { project: "elsewhere", parentId: "page-1" },
      }),
    );
    expect(result.sources[1]).toMatchObject({ project: "elsewhere" });
    expect(result.wiki).toEqual({ project: "elsewhere", parentId: "page-1" });
  });
});

describe("readStructuredManifest structure errors", () => {
  it.each([
    ["a non-object", "manifest"],
    ["an array", []],
    ["null", null],
    ["a version of 2", manifest({ version: "2" })],
    ["a numeric version", manifest({ version: 1 })],
    ["no sources", { version: "1" }],
    ["sources that are no list", manifest({ sources: {} })],
    ["an unknown top-level key", manifest({ projects: [] })],
    ["links that are null", manifest({ links: null })],
    ["assets that are no list", manifest({ assets: "a" })],
    ["a wiki target that is no object", manifest({ wiki: "p" })],
    ["a wiki target without a parent", manifest({ wiki: { project: "main" } })],
    [
      "a wiki target with a blank parent",
      manifest({ wiki: { parentId: " " } }),
    ],
    [
      "a wiki target with an unknown key",
      manifest({ wiki: { parentId: null, title: "x" } }),
    ],
  ])("refuses %s", (_, input) => {
    expectInvalidRequest(() => readStructuredManifest(input));
  });
});

describe("readStructuredManifest source errors", () => {
  it.each([
    ["an unknown kind", { kind: "sprint", key: "s" }],
    ["no kind", { key: "t" }],
    ["a non-object source", "ticket"],
    ["a project without an ID", { kind: "project", key: "p" }],
    [
      "a project with a blank ID",
      { kind: "project", key: "p", projectId: " " },
    ],
    [
      "a project with an overlong ID",
      { kind: "project", key: "p", projectId: "x".repeat(201) },
    ],
    ["a ticket of an unknown type", { ...TICKET, type: "story" }],
    ["a ticket without a title", { ...TICKET, title: undefined }],
    ["a ticket with a numeric key", { ...TICKET, key: 5 }],
    ["a ticket with an unknown field", { ...TICKET, labels: [] }],
    ["a milestone without a name", { ...MILESTONE, name: undefined }],
    ["a milestone with a numeric date", { ...MILESTONE, dueAt: 20261201 }],
    ["a wiki page without content", { kind: "wiki", key: "a.md" }],
    [
      "a wiki page with a numeric title",
      { kind: "wiki", key: "a.md", content: "", title: 3 },
    ],
    ["a project with a ticket field", { ...PROJECT, title: "x" }],
  ])("refuses %s", (_, source) => {
    expectInvalidRequest(() =>
      readStructuredManifest(manifest({ sources: [source] })),
    );
  });

  it("limits keys to 100 characters", () => {
    const keyed = (key: string): unknown =>
      manifest({ sources: [{ ...TICKET, key }] });
    expect(readStructuredManifest(keyed("k".repeat(100)))).toBeDefined();
    expectInvalidRequest(() => readStructuredManifest(keyed("k".repeat(101))));
  });
});

describe("readStructuredManifest link and asset errors", () => {
  it.each([
    [
      "a dependency without a link type",
      { type: "dependency", from: "a", to: "b" },
    ],
    [
      "a dependency with an unknown link type",
      { type: "dependency", from: "a", to: "b", linkType: "duplicates" },
    ],
    [
      "a parent link with a link type",
      { type: "parent", from: "a", to: "b", linkType: "blocks" },
    ],
    ["an unknown link type name", { type: "child", from: "a", to: "b" }],
    ["a link without a target", { type: "parent", from: "a" }],
    [
      "a link with an overlong key",
      { type: "parent", from: "a".repeat(101), to: "b" },
    ],
    ["an extra field", { type: "parent", from: "a", to: "b", note: "x" }],
  ])("refuses %s", (_, link) => {
    expectInvalidRequest(() =>
      readStructuredManifest(manifest({ links: [link] })),
    );
  });

  it.each([
    ["a missing asset ID", { path: "a.png" }],
    ["a blank asset ID", { path: "a.png", assetId: "" }],
    ["a path that is no string", { path: 4, assetId: "x" }],
    ["an unknown field", { path: "a.png", assetId: "x", mime: "image/png" }],
  ])("refuses an asset with %s", (_, asset) => {
    expectInvalidRequest(() =>
      readStructuredManifest(manifest({ assets: [asset] })),
    );
  });
});
