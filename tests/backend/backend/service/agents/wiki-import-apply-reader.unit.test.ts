import { expect, it } from "vitest";

import { readWikiImportApply } from "@/backend/service/agents/WikiImportApplyReader";

const input = {
  operationId: "op",
  fingerprint: "a".repeat(64),
  projectId: "project",
  parentId: null,
  manifest: {
    version: "1",
    index: [{ sourceKey: "one.md", title: "One", titleSource: "explicit" }],
    files: [
      { sourceKey: "one.md", content: "# One" },
      { sourceKey: "two.md", content: "# Two" },
    ],
  },
};

it("validates a confirmed package and normalizes asset bindings", () => {
  expect(
    readWikiImportApply({
      ...input,
      assets: [
        { sourceKey: "two.md", assetIds: ["z", "a"] },
        { sourceKey: "one.md", assetIds: [] },
      ],
    }),
  ).toMatchObject({
    assets: [
      { sourceKey: "one.md", assetIds: [] },
      { sourceKey: "two.md", assetIds: ["a", "z"] },
    ],
  });
  expect(readWikiImportApply(input).assets).toEqual([]);
});

it.each([
  null,
  [],
  { ...input, extra: true },
  { ...input, operationId: " " },
  { ...input, fingerprint: "A".repeat(64) },
  { ...input, assets: null },
  { ...input, assets: [{ sourceKey: "missing.md", assetIds: [] }] },
  {
    ...input,
    assets: [
      { sourceKey: "one.md", assetIds: [] },
      { sourceKey: "one.md", assetIds: [] },
    ],
  },
  { ...input, assets: [{ sourceKey: "one.md", assetIds: ["a", "a"] }] },
  { ...input, assets: [{ sourceKey: "one.md", assetIds: [], extra: true }] },
])("rejects malformed packages and asset references", (value) => {
  expect(() => readWikiImportApply(value)).toThrow();
});
