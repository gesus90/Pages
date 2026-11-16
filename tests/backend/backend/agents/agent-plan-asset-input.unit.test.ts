import { expect, it } from "vitest";

import {
  readPlanAssetFile,
  readPlanAssetNode,
} from "@/backend/agents/AgentPlanAssetInput";

const file = {
  assetId: " asset ",
  fileName: "file.txt",
  mediaType: "text/plain",
  kind: "document",
  size: 5,
  digest: "a".repeat(64),
};

it("validates a pinned file and trims its identifier", () => {
  expect(readPlanAssetFile(file)).toEqual({ ...file, assetId: "asset" });
  expect(
    readPlanAssetNode({ id: "node", x: 1, y: 2 }, { name: "File", file: null }),
  ).toMatchObject({ type: "asset", file: null });
  expect(
    readPlanAssetNode({ id: "node", x: 1, y: 2 }, { name: "File", file }),
  ).toMatchObject({ file: { assetId: "asset" } });
});

it.each([
  null,
  [],
  { ...file, extra: true },
  { ...file, assetId: " " },
  { ...file, fileName: "bad\nname" },
  { ...file, mediaType: "TEXT/plain" },
  { ...file, kind: "unknown" },
  { ...file, size: -1 },
  { ...file, size: 1.5 },
  { ...file, digest: "A".repeat(64) },
  { ...file, digest: "short" },
])("rejects malformed asset metadata", (value) => {
  expect(() => readPlanAssetFile(value)).toThrow();
});
