import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export const BACKEND_TEST_GLOB = "backend/**/*.{test,spec}.ts";
export const BACKEND_COVERAGE_EXCLUDES = [
  "backend/**/*.d.{ts,mts,cts}",
  BACKEND_TEST_GLOB,
];
export const FIRST_SECTION_COVERAGE_GLOB =
  "backend/{discord,cache,concurrency}/**/*.{ts,tsx,mts,cts,js,mjs,cjs}";
export const SECOND_SECTION_COVERAGE_GLOB =
  "backend/{github,security,setup}/**/*.{ts,tsx,mts,cts,js,mjs,cjs}";
export const THIRD_SECTION_COVERAGE_GLOB =
  "backend/{storage,google,config,remote}/**/*.{ts,tsx,mts,cts,js,mjs,cjs}";

// These are required minimums, not claims about measured coverage.
export const BACKEND_COVERAGE_SECTIONS = [
  {
    name: "first-section",
    include: FIRST_SECTION_COVERAGE_GLOB,
    minimum: 100,
  },
  {
    name: "second-section",
    include: SECOND_SECTION_COVERAGE_GLOB,
    minimum: 100,
  },
  {
    name: "third-section",
    include: THIRD_SECTION_COVERAGE_GLOB,
    minimum: 100,
  },
] as const;

const thresholds = Object.fromEntries(
  BACKEND_COVERAGE_SECTIONS.map(
    (section) =>
      [
        section.include,
        {
          perFile: true,
          statements: section.minimum,
          branches: section.minimum,
          functions: section.minimum,
          lines: section.minimum,
        },
      ] as const,
  ),
);

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    name: "backend",
    environment: "node",
    include: BACKEND_COVERAGE_SECTIONS.map((section) =>
      section.include.replace(
        "*.{ts,tsx,mts,cts,js,mjs,cjs}",
        "*.{test,spec}.ts",
      ),
    ),
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
      include: BACKEND_COVERAGE_SECTIONS.map((section) => section.include),
      exclude: BACKEND_COVERAGE_EXCLUDES,
      reportsDirectory: "coverage/backend",
      reporter: ["json", "json-summary"],
      skipFull: false,
      clean: true,
      reportOnFailure: true,
      processingConcurrency: 2,
      thresholds,
    },
  },
});
