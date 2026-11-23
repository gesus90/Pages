import { describe, expect, it } from "vitest";

import {
  readPlanAssetFile,
  readPlanAssetNode,
} from "@/backend/agents/AgentPlanAssetInput";
import { AgentError } from "@/backend/error/AgentErrors";

const FILE = {
  assetId: "asset-1",
  fileName: "picture.png",
  mediaType: "image/png",
  kind: "image",
  size: 12,
  digest: "a".repeat(64),
};

const BASE = { id: "n", x: 1, y: 2 };

function codeOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    return error instanceof AgentError ? error.code : undefined;
  }
  return undefined;
}

describe("readPlanAssetFile", () => {
  it("reads a file and trims the asset id", () => {
    expect(readPlanAssetFile(FILE)).toEqual(FILE);
    expect(
      readPlanAssetFile({ ...FILE, assetId: " asset-1 ", size: 0 }),
    ).toEqual({ ...FILE, size: 0 });
  });

  it("rejects every malformed field", () => {
    const invalid = [
      null,
      "file",
      [FILE],
      { ...FILE, extra: 1 },
      { ...FILE, assetId: " " },
      { ...FILE, assetId: "x".repeat(101) },
      { ...FILE, fileName: "a\nb" },
      { ...FILE, fileName: "x".repeat(301) },
      { ...FILE, mediaType: 1 },
      { ...FILE, mediaType: "image" },
      { ...FILE, kind: "program" },
      { ...FILE, size: -1 },
      { ...FILE, size: 1.5 },
      { ...FILE, size: "1" },
      { ...FILE, digest: 1 },
      { ...FILE, digest: "A".repeat(64) },
    ];
    for (const input of invalid)
      expect(codeOf(() => readPlanAssetFile(input))).toBe("plan_asset_invalid");
  });
});

describe("readPlanAssetNode", () => {
  it("builds a node with a file or as a draft without one", () => {
    expect(readPlanAssetNode(BASE, { name: "A", file: FILE })).toEqual({
      ...BASE,
      type: "asset",
      name: "A",
      file: FILE,
    });
    expect(readPlanAssetNode(BASE, { name: "A", file: null }).file).toBeNull();
    expect(
      readPlanAssetNode(BASE, { name: "A", file: undefined }).file,
    ).toBeNull();
  });

  it("rejects a malformed file", () => {
    expect(codeOf(() => readPlanAssetNode(BASE, { name: "A", file: 1 }))).toBe(
      "plan_asset_invalid",
    );
  });
});
