import { describe, expect, it } from "vitest";

import { wikiImportFingerprint } from "@/backend/service/agents/WikiImportFingerprint";

import type { WikiImportTargetState } from "@/backend/service/agents/WikiImportFingerprint";
import type { AgentImportPlanInput } from "@/definition/AgentImportManifest";

const input: AgentImportPlanInput = {
  projectId: "project",
  parentId: "parent",
  manifest: {
    version: "1",
    index: [
      { sourceKey: "a.md", title: "A", titleSource: "h1" },
      { sourceKey: "b.md", title: "Explicit", titleSource: "explicit" },
    ],
    files: [
      { sourceKey: "a.md", content: "# A\r\n" },
      { sourceKey: "b.md", content: "Body", title: "Explicit" },
    ],
  },
};
const state: WikiImportTargetState = {
  canWrite: true,
  parents: [
    { id: "parent", revision: 2, parentId: "root" },
    { id: "root", revision: 1, parentId: null },
  ],
  children: [
    { id: "one", title: "One" },
    { id: "two", title: "Two" },
  ],
};

describe("wiki import SHA-256", () => {
  it("is deterministic across collection order and JSON property order", () => {
    const fingerprint = wikiImportFingerprint(input, state);
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(wikiImportFingerprint(input, state)).toBe(fingerprint);
    const reordered: AgentImportPlanInput = {
      manifest: {
        files: [...input.manifest.files].reverse(),
        index: [...input.manifest.index].reverse(),
        version: "1",
      },
      parentId: "parent",
      projectId: "project",
    };
    expect(
      wikiImportFingerprint(reordered, {
        canWrite: true,
        parents: [...state.parents].reverse(),
        children: [...state.children].reverse(),
      }),
    ).toBe(fingerprint);
  });

  it("changes with source bytes, title metadata, package, destination, revision, visible siblings and rights", () => {
    const original = wikiImportFingerprint(input, state);
    const variants: AgentImportPlanInput[] = [
      { ...input, projectId: "other" },
      { ...input, parentId: null },
      { ...input, manifest: { ...input.manifest, files: [] } },
      {
        ...input,
        manifest: {
          ...input.manifest,
          files: [{ sourceKey: "a.md", content: "# A\n" }],
        },
      },
      {
        ...input,
        manifest: {
          ...input.manifest,
          index: [
            { sourceKey: "a.md", title: "Different", titleSource: "explicit" },
          ],
        },
      },
      {
        ...input,
        manifest: {
          ...input.manifest,
          index: [...input.manifest.index, ...input.manifest.index],
        },
      },
    ];
    for (const variant of variants)
      expect(wikiImportFingerprint(variant, state)).not.toBe(original);
    for (const variant of [
      { ...state, canWrite: false },
      { ...state, parents: [{ id: "parent", revision: 3, parentId: "root" }] },
      { ...state, children: [{ id: "one", title: "Renamed" }] },
      { ...state, children: [...state.children, { id: "new", title: "New" }] },
    ])
      expect(wikiImportFingerprint(input, variant)).not.toBe(original);
  });
});
