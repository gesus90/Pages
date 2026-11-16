import { expect, it } from "vitest";

import { readWikiImportUpdate } from "@/backend/service/agents/WikiImportUpdateReader";

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
  updates: [
    { sourceKey: "two.md", expectedRevision: 2, overwrite: true },
    { sourceKey: "one.md", expectedRevision: 1 },
  ],
};

it("normalizes revisions and requires an explicit entry for every loaded file", () => {
  expect(readWikiImportUpdate(input).updates).toEqual([
    { sourceKey: "one.md", expectedRevision: 1, overwrite: false },
    { sourceKey: "two.md", expectedRevision: 2, overwrite: true },
  ]);
});

it.each([
  null,
  [],
  { ...input, extra: true },
  { ...input, operationId: "" },
  { ...input, fingerprint: "A".repeat(64) },
  { ...input, updates: null },
  { ...input, updates: [] },
  { ...input, updates: [{ sourceKey: "one.md", expectedRevision: 1 }] },
  {
    ...input,
    updates: [
      { sourceKey: "one.md", expectedRevision: 1 },
      { sourceKey: "one.md", expectedRevision: 2 },
    ],
  },
  {
    ...input,
    updates: [
      { sourceKey: "one.md", expectedRevision: 0 },
      { sourceKey: "two.md", expectedRevision: 1 },
    ],
  },
  {
    ...input,
    updates: [
      { sourceKey: "one.md", expectedRevision: 1, overwrite: "yes" },
      { sourceKey: "two.md", expectedRevision: 1 },
    ],
  },
  {
    ...input,
    updates: [
      { sourceKey: "one.md", expectedRevision: 1 },
      { sourceKey: "missing.md", expectedRevision: 1 },
    ],
  },
])("rejects ambiguous, malformed or stale revision entries", (value) => {
  expect(() => readWikiImportUpdate(value)).toThrow();
});
