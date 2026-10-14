import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import manifest from "../package.json" with { type: "json" };

/** Options of the mocked esbuild call that the build script controls. */
interface BundleOptions {
  readonly entryPoints: readonly string[];
  readonly outfile: string;
}

const rmMock = vi.hoisted(() =>
  vi.fn<(target: string, options: object) => Promise<void>>(),
);
const buildMock = vi.hoisted(() =>
  vi.fn<(options: BundleOptions) => Promise<object>>(),
);

vi.mock("node:fs/promises", () => ({ rm: rmMock }));
vi.mock("esbuild", () => ({ build: buildMock }));

beforeEach(() => {
  rmMock.mockReset();
  buildMock.mockReset();
  rmMock.mockResolvedValue(undefined);
  buildMock.mockResolvedValue({ errors: [], warnings: [] });
  vi.resetModules();
});

afterEach(() => {
  vi.resetModules();
});

describe("build.config", () => {
  it("removes old output, then bundles the versioned CommonJS file", async () => {
    await import("../build.config.ts");

    expect(rmMock).toHaveBeenCalledExactlyOnceWith("dist", {
      recursive: true,
      force: true,
    });
    expect(buildMock).toHaveBeenCalledExactlyOnceWith({
      entryPoints: ["src/main.ts"],
      outfile: `dist/pages-mcp-v${manifest.version}.cjs`,
      bundle: true,
      platform: "node",
      target: "node24",
      format: "cjs",
      splitting: false,
      sourcemap: false,
    });
    expect(rmMock.mock.invocationCallOrder[0]).toBeLessThan(
      buildMock.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("does not bundle when the old output cannot be removed", async () => {
    rmMock.mockRejectedValue(new Error("EACCES: dist"));

    await expect(import("../build.config.ts")).rejects.toThrow("EACCES: dist");
    expect(buildMock).not.toHaveBeenCalled();
  });

  it("fails when esbuild reports an error", async () => {
    buildMock.mockRejectedValue(new Error("Build failed with 1 error"));

    await expect(import("../build.config.ts")).rejects.toThrow(
      "Build failed with 1 error",
    );
    expect(rmMock).toHaveBeenCalledTimes(1);
  });
});
