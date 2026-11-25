import { describe, expect, it } from "vitest";

import { readDeploymentBuild } from "./DeploymentBuild";

describe("readDeploymentBuild", () => {
  it("returns the validated build identity", async () => {
    const manifest = { commit: "abcdef12", builtAt: "2026-01-02T03:04:05Z" };
    const build = await readDeploymentBuild(async (path) => {
      expect(path).toMatch(/deployment\.json$/u);
      return JSON.stringify(manifest);
    });
    expect(build).toEqual(manifest);
  });

  it("returns null for a missing file", async () => {
    expect(await readDeploymentBuild(async () => null)).toBeNull();
  });

  it("returns null for a manifest that fails validation", async () => {
    expect(
      await readDeploymentBuild(async () => JSON.stringify({ commit: "x" })),
    ).toBeNull();
  });

  it("returns null for malformed JSON", async () => {
    expect(await readDeploymentBuild(async () => "{")).toBeNull();
  });
});
