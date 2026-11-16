import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export const BACKEND_SOURCE_GLOB = "backend/**/*.{ts,tsx,mts,cts,js,mjs,cjs}";
export const BACKEND_TEST_GLOB = "backend/**/*.{test,spec}.ts";
export const BACKEND_COVERAGE_EXCLUDES = [
  "backend/**/*.d.{ts,mts,cts}",
  BACKEND_TEST_GLOB,
];
export const FIRST_SECTION_COVERAGE_GLOB =
  "backend/{discord,cache,concurrency}/**/*.{ts,tsx,mts,cts,js,mjs,cjs}";

// This is a required minimum, not a claim about measured coverage.
const FIRST_SECTION_MINIMUM = 100;

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    name: "backend",
    environment: "node",
    include: [BACKEND_TEST_GLOB],
    pool: "forks",
    maxWorkers: 2,
    isolate: true,
    allowOnly: false,
    passWithNoTests: false,
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    coverage: {
      provider: "v8",
      include: [BACKEND_SOURCE_GLOB],
      exclude: BACKEND_COVERAGE_EXCLUDES,
      reportsDirectory: "coverage/backend",
      reporter: ["text", "json", "json-summary"],
      skipFull: false,
      clean: true,
      reportOnFailure: true,
      processingConcurrency: 2,
      thresholds: {
        [FIRST_SECTION_COVERAGE_GLOB]: {
          perFile: true,
          statements: FIRST_SECTION_MINIMUM,
          branches: FIRST_SECTION_MINIMUM,
          functions: FIRST_SECTION_MINIMUM,
          lines: FIRST_SECTION_MINIMUM,
        },
      },
    },
  },
});
