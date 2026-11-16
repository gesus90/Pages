import { describe, expect, it } from "vitest";

import { patchPicaCodexAdapter } from "@/backend/agents/acp/PicaCodexAdapterPatch";

const metadata = JSON.stringify({
  name: "@agentclientprotocol/codex-acp",
  version: "2.2.2",
  license: "Apache-2.0",
});
const glue = {
  path: "/virtual/glue.mjs",
  upstreamBundlePath: "/virtual/bundle.mjs",
  sha256: "a".repeat(64),
};

describe("Pica Codex adapter patch validation", () => {
  it("rejects unsupported package metadata before touching the bundle", () => {
    for (const value of [
      "null",
      "{}",
      JSON.stringify({
        name: "other",
        version: "2.2.2",
        license: "Apache-2.0",
      }),
      JSON.stringify({
        name: "@agentclientprotocol/codex-acp",
        version: "1",
        license: "Apache-2.0",
      }),
    ]) {
      expect(() => patchPicaCodexAdapter("bundle", value, glue)).toThrow(
        "Unsupported Codex adapter package",
      );
    }
  });

  it("rejects relative or unnormalized paths and malformed digests", () => {
    for (const value of [
      { ...glue, path: "relative" },
      { ...glue, path: "/virtual/../glue" },
      { ...glue, upstreamBundlePath: "relative" },
      { ...glue, upstreamBundlePath: "/virtual/../bundle" },
      { ...glue, sha256: "BAD" },
    ]) {
      expect(() => patchPicaCodexAdapter("bundle", metadata, value)).toThrow(
        "Invalid Pica adapter glue source",
      );
    }
  });

  it("requires the pinned upstream bundle digest", () => {
    expect(() =>
      patchPicaCodexAdapter("different bundle", metadata, glue),
    ).toThrow("Unsupported Codex adapter bundle");
  });
});
