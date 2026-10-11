import { describe, expect, it } from "vitest";

import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { readWikiImportApply } from "@/backend/service/agents/WikiImportApplyReader";
import { PAGES_AGENT_LIMITS } from "@/definition/PagesAgentOperations";

import { importRequest } from "../helpers/wiki-import";

const request = {
  ...importRequest(),
  operationId: "import",
  fingerprint: "a".repeat(64),
};

describe("wiki import application validation", () => {
  it("accepts omitted assets and canonicalizes bindings and asset IDs without changing Markdown", () => {
    expect(readWikiImportApply(request)).toEqual({ ...request, assets: [] });
    const input = {
      ...request,
      ...importRequest([
        { sourceKey: "a.md", content: "# A\r\n" },
        { sourceKey: "b.md", content: "# B" },
      ]),
      assets: [
        { sourceKey: "b.md", assetIds: ["z", "a"] },
        { sourceKey: "a.md", assetIds: [] },
      ],
    };
    expect(readWikiImportApply(input)).toEqual({
      ...input,
      assets: [
        { sourceKey: "a.md", assetIds: [] },
        { sourceKey: "b.md", assetIds: ["a", "z"] },
      ],
    });
    expect(input.assets[0]?.assetIds).toEqual(["z", "a"]);
  });

  it.each([null, undefined, [], "request", 1])(
    "rejects a non-record envelope %j",
    (input) => {
      expect(() => readWikiImportApply(input)).toThrow(AgentOperationError);
    },
  );

  it.each([
    { actor: {} },
    { operationId: undefined },
    { operationId: "" },
    { operationId: " " },
    { operationId: "x".repeat(201) },
    { fingerprint: 1 },
    { fingerprint: "A".repeat(64) },
    { fingerprint: "a".repeat(63) },
    { assets: null },
    {
      assets: [
        { sourceKey: "new.md", assetIds: [] },
        { sourceKey: "other.md", assetIds: [] },
      ],
    },
    { assets: [null] },
    { assets: [{ sourceKey: "new.md", assetIds: [], extra: true }] },
    { assets: [{ sourceKey: 1, assetIds: [] }] },
    { assets: [{ sourceKey: "new.md", assetIds: null }] },
    { assets: [{ sourceKey: "missing.md", assetIds: [] }] },
  ])("rejects malformed or injected fields %j", (fields) => {
    expect(() => readWikiImportApply({ ...request, ...fields })).toThrow(
      AgentOperationError,
    );
  });

  it("rejects duplicate source bindings even when they fit the package size", () => {
    const input = importRequest([
      { sourceKey: "a.md", content: "" },
      { sourceKey: "b.md", content: "" },
    ]);
    expect(() =>
      readWikiImportApply({
        ...request,
        ...input,
        assets: [
          { sourceKey: "a.md", assetIds: [] },
          { sourceKey: "a.md", assetIds: [] },
        ],
      }),
    ).toThrow(AgentOperationError);
  });

  it("bounds the complete apply envelope including operation metadata and assets", () => {
    const input = importRequest(
      Array.from({ length: 4 }, (_, index) => ({
        sourceKey: `${index}.md`,
        content: "",
      })),
    );
    const assets = input.manifest.files.map((file) => ({
      sourceKey: file.sourceKey,
      assetIds: Array.from({ length: 100 }, (_, index) =>
        `${index}`.padEnd(190, "x"),
      ),
    }));
    expect(() => readWikiImportApply({ ...request, ...input, assets })).toThrow(
      expect.objectContaining({
        code: "PAYLOAD_TOO_LARGE",
        details: {
          constraint: "requestBytes",
          limit: PAGES_AGENT_LIMITS.requestBytes,
        },
      }),
    );
  });
});
