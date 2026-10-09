import { rm } from "node:fs/promises";

import { build } from "esbuild";

import manifest from "./package.json" with { type: "json" };

await rm("dist", { recursive: true, force: true });
await build({
  entryPoints: ["src/main.ts"],
  outfile: `dist/pages-mcp-v${manifest.version}.js`,
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  splitting: false,
  sourcemap: false,
});
