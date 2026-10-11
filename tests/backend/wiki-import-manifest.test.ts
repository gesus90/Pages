import { describe, expect, it } from "vitest";

import { readWikiImportManifest } from "@/backend/service/agents/WikiImportManifestReader";
import { AGENT_IMPORT_LIMITS } from "@/definition/AgentImportManifest";
import { PAGES_AGENT_LIMITS } from "@/definition/PagesAgentOperations";

const entry = { sourceKey: "a.md", title: "A", titleSource: "h1" };
const file = { sourceKey: "a.md", content: "# A" };
const request = {
  projectId: "p",
  parentId: null,
  manifest: { version: "1", index: [entry], files: [file] },
};

describe("strict import package contract", () => {
  it("accepts index-only, explicit-title and existing-parent packages", () => {
    expect(readWikiImportManifest(request)).toEqual(request);
    expect(
      readWikiImportManifest({
        ...request,
        parentId: "parent",
        manifest: { ...request.manifest, files: [] },
      }),
    ).toMatchObject({ parentId: "parent", manifest: { files: [] } });
    expect(
      readWikiImportManifest({
        ...request,
        manifest: {
          ...request.manifest,
          index: [{ ...entry, titleSource: "explicit" }],
          files: [{ ...file, title: "A" }],
        },
      }),
    ).toMatchObject({ manifest: { files: [{ title: "A" }] } });
    expect(
      readWikiImportManifest({
        ...request,
        manifest: {
          ...request.manifest,
          index: [{ ...entry, titleSource: "filename" }],
        },
      }),
    ).toBeDefined();
  });

  it.each([
    undefined,
    null,
    [],
    "invalid",
    {},
    { ...request, actor: "foreign" },
    { ...request, projectId: null },
    { ...request, projectId: " " },
    { ...request, projectId: "x".repeat(201) },
    { ...request, parentId: undefined },
    { ...request, manifest: null },
    { ...request, manifest: { ...request.manifest, version: "2" } },
    { ...request, manifest: { ...request.manifest, index: null } },
    { ...request, manifest: { ...request.manifest, index: [] } },
    { ...request, manifest: { ...request.manifest, files: null } },
    { ...request, manifest: { ...request.manifest, extra: true } },
    { ...request, manifest: { ...request.manifest, index: [null] } },
    {
      ...request,
      manifest: { ...request.manifest, index: [{ ...entry, extra: true }] },
    },
    {
      ...request,
      manifest: { ...request.manifest, index: [{ ...entry, sourceKey: 1 }] },
    },
    {
      ...request,
      manifest: { ...request.manifest, index: [{ ...entry, title: null }] },
    },
    {
      ...request,
      manifest: {
        ...request.manifest,
        index: [{ ...entry, titleSource: "other" }],
      },
    },
    { ...request, manifest: { ...request.manifest, files: [null] } },
    {
      ...request,
      manifest: { ...request.manifest, files: [{ ...file, content: 1 }] },
    },
    {
      ...request,
      manifest: { ...request.manifest, files: [{ ...file, title: null }] },
    },
    {
      ...request,
      manifest: {
        ...request.manifest,
        files: [{ ...file, ownerId: "foreign" }],
      },
    },
  ])("rejects malformed or untrusted input %j", (input) => {
    expect(() => readWikiImportManifest(input)).toThrow(
      expect.objectContaining({ code: "INVALID_REQUEST", status: 400 }),
    );
  });

  it.each([
    [
      "importIndexEntries",
      AGENT_IMPORT_LIMITS.indexEntries,
      {
        ...request,
        manifest: { ...request.manifest, index: Array(129).fill(entry) },
      },
    ],
    [
      "importFiles",
      AGENT_IMPORT_LIMITS.files,
      {
        ...request,
        manifest: { ...request.manifest, files: Array(33).fill(file) },
      },
    ],
    [
      "importFileBytes",
      AGENT_IMPORT_LIMITS.fileBytes,
      {
        ...request,
        manifest: {
          ...request.manifest,
          files: [{ ...file, content: "😀".repeat(4097) }],
        },
      },
    ],
    [
      "importContentBytes",
      AGENT_IMPORT_LIMITS.contentBytes,
      {
        ...request,
        manifest: {
          ...request.manifest,
          files: Array.from({ length: 3 }, (_, index) => ({
            sourceKey: `${index}.md`,
            content: "a".repeat(16_384),
          })),
        },
      },
    ],
    [
      "importPathBytes",
      AGENT_IMPORT_LIMITS.pathBytes,
      {
        ...request,
        manifest: {
          ...request.manifest,
          index: [{ ...entry, sourceKey: "😀".repeat(128) + ".md" }],
        },
      },
    ],
    [
      "requestBytes",
      PAGES_AGENT_LIMITS.requestBytes,
      {
        ...request,
        manifest: {
          ...request.manifest,
          files: [{ ...file, content: "\u0001".repeat(16_384) }],
        },
      },
    ],
  ] as const)(
    "rejects %s overflow with its concrete limit",
    (constraint, limit, input) => {
      expect(() => readWikiImportManifest(input)).toThrow(
        expect.objectContaining({
          code: "PAYLOAD_TOO_LARGE",
          status: 413,
          details: { constraint, limit },
        }),
      );
    },
  );

  it("accepts exact content and path byte limits and exact count limits", () => {
    expect(
      readWikiImportManifest({
        ...request,
        manifest: {
          ...request.manifest,
          files: [
            { ...file, content: "x".repeat(16_384) },
            { sourceKey: "b.md", content: "y".repeat(16_384) },
          ],
        },
      }),
    ).toBeDefined();
    expect(
      readWikiImportManifest({
        ...request,
        manifest: {
          ...request.manifest,
          index: Array(128).fill(entry),
          files: Array(32).fill(file),
        },
      }),
    ).toBeDefined();
    expect(
      readWikiImportManifest({
        ...request,
        manifest: {
          ...request.manifest,
          index: [{ ...entry, sourceKey: "a".repeat(509) + ".md" }],
        },
      }),
    ).toBeDefined();
  });

  it("accepts exactly 64 KiB of serialized JSON including escapes and rejects one more byte", () => {
    const empty = {
      ...request,
      manifest: {
        ...request.manifest,
        files: [{ ...file, content: "" }],
      },
    };
    const overhead = Buffer.byteLength(
      JSON.stringify({ operation: "wiki.import.plan", parameters: empty }),
    );
    const availableBytes = PAGES_AGENT_LIMITS.requestBytes - overhead;
    const content =
      "\u0001".repeat(Math.floor(availableBytes / 6)) +
      "x".repeat(availableBytes % 6);
    const exact = {
      ...empty,
      manifest: { ...empty.manifest, files: [{ ...file, content }] },
    };
    expect(Buffer.byteLength(content)).toBeLessThan(
      AGENT_IMPORT_LIMITS.fileBytes,
    );
    expect(
      Buffer.byteLength(
        JSON.stringify({ operation: "wiki.import.plan", parameters: exact }),
      ),
    ).toBe(PAGES_AGENT_LIMITS.requestBytes);
    expect(readWikiImportManifest(exact)).toEqual(exact);
    expect(() =>
      readWikiImportManifest({
        ...exact,
        manifest: {
          ...exact.manifest,
          files: [{ ...file, content: content + "x" }],
        },
      }),
    ).toThrow(
      expect.objectContaining({
        code: "PAYLOAD_TOO_LARGE",
        details: { constraint: "requestBytes", limit: 65_536 },
      }),
    );
  });

  it.each(["index", "files"] as const)(
    "counts multibyte source paths at the exact byte boundary in %s",
    (collection) => {
      const sourceKey = "😀".repeat(126) + "abcde.md";
      expect(Buffer.byteLength(sourceKey)).toBe(AGENT_IMPORT_LIMITS.pathBytes);
      const exact = {
        ...request,
        manifest: {
          ...request.manifest,
          index: [{ ...entry, sourceKey }],
          files: [{ ...file, sourceKey }],
        },
      };
      expect(readWikiImportManifest(exact)).toEqual(exact);
      const entries = exact.manifest[collection].map((item) => ({
        ...item,
        sourceKey: "x" + item.sourceKey,
      }));
      expect(() =>
        readWikiImportManifest({
          ...exact,
          manifest: { ...exact.manifest, [collection]: entries },
        }),
      ).toThrow(
        expect.objectContaining({
          code: "PAYLOAD_TOO_LARGE",
          details: { constraint: "importPathBytes", limit: 512 },
        }),
      );
    },
  );
});
