import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vitest/config";

/** One-off unit run of the MCP package; every metric must stay at 100 %. */
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    name: "pages-mcp-unit",
    environment: "node",
    include: ["tests/**/*.unit.test.ts"],
    globals: false,
    isolate: true,
    passWithNoTests: false,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    coverage: {
      enabled: true,
      provider: "v8",
      // Every executable file of the package, imported by a test or not.
      // Tests, dependencies and generated output lie outside these paths.
      include: ["src/**/*.ts", "scripts/**/*.ts", "build.config.ts"],
      reporter: [["text", { skipFull: false }], "html"],
      reportsDirectory: "coverage",
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
