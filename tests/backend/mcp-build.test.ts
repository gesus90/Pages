import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("MCP single-file build", () => {
  it("replaces stale output and runs independently of the package tree", async () => {
    const originalDirectory = process.cwd();
    const directory = await mkdtemp(path.join(tmpdir(), "pages-mcp-build-"));
    const source = fileURLToPath(new URL("../../mcp/src", import.meta.url));
    try {
      await symlink(source, path.join(directory, "src"), "dir");
      await mkdir(path.join(directory, "dist"));
      await writeFile(path.join(directory, "dist", "stale.txt"), "stale build");
      process.chdir(directory);
      await import("../../mcp/build.config");
      expect(await readdir(path.join(directory, "dist"))).toEqual([
        "pages-mcp-v0.1.0.js",
      ]);
      const bundle = path.join(directory, "dist", "pages-mcp-v0.1.0.js");
      expect(await readFile(bundle, "utf8")).toContain("pages-mcp");
      const runtime = spawnSync(process.execPath, [bundle], {
        cwd: tmpdir(),
        env: {
          PAGES_URL: "https://pages.invalid",
          PAGES_TOKEN: "synthetic-credential",
        },
        input: "",
        encoding: "utf8",
        timeout: 5_000,
      });
      expect(runtime.status).toBe(0);
      expect(runtime.stdout).toBe("");
      expect(runtime.stderr).toBe("");
    } finally {
      process.chdir(originalDirectory);
      await rm(directory, { recursive: true, force: true });
    }
  });
});
