import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vitest/config";

const projectAlias = {
  "@": fileURLToPath(new URL(".", import.meta.url)),
};

/**
 * Resolves the test scope from the `VITEST_FRONTEND` and `VITEST_BACKEND`
 * environment flags set by the `test:frontend` and `test:backend` scripts.
 *
 * @returns The selected scope, defaulting to every suite.
 */
function resolveTestScope(): "frontend" | "backend" | "all" {
  if (process.env.VITEST_FRONTEND === "true") {
    return "frontend";
  }

  if (process.env.VITEST_BACKEND === "true") {
    return "backend";
  }

  return "all";
}

/**
 * Resolves the test files for a scope.
 *
 * @param scope - Scope selected through the environment flags.
 * @returns Glob patterns covering the scope, including future directories.
 */
function resolveTestInclude(scope: "frontend" | "backend" | "all"): string[] {
  if (scope === "frontend") {
    return ["tests/frontend/**/*.test.{ts,tsx}"];
  }

  if (scope === "backend") {
    return ["tests/backend/**/*.test.{ts,tsx}"];
  }

  return ["tests/**/*.test.{ts,tsx}"];
}

/**
 * Resolves the source files a scope reports coverage for.
 *
 * @param scope - Scope selected through the environment flags.
 * @returns Glob patterns covering exactly the sources the scope can verify,
 * so each run gates its own files at 100% without further configuration.
 *
 * @remarks
 * Suites below `tests/frontend/` verify everything below `app/`, including
 * its server-side loaders and actions. Suites below `tests/backend/`
 * verify the backend core below `backend/` together with `definition/` and
 * `language/`.
 */
function resolveCoverageInclude(
  scope: "frontend" | "backend" | "all",
): string[] {
  if (scope === "frontend") {
    return ["app/**/*.{ts,tsx}"];
  }

  if (scope === "backend") {
    return ["backend/**/*.ts", "definition/**/*.ts", "language/**/*.ts"];
  }

  return ["**/*.{ts,tsx}"];
}

const testScope = resolveTestScope();

export default defineConfig({
  resolve: {
    alias: projectAlias,
  },
  test: {
    clearMocks: true,
    // Suites below `tests/frontend/` declare `// @vitest-environment jsdom`
    // at the top of the file; everything else runs in Node.
    environment: "node",
    include: resolveTestInclude(testScope),
    mockReset: true,
    restoreMocks: true,
    setupFiles: ["tests/frontend/setup.ts"],
    unstubEnvs: true,
    unstubGlobals: true,
    coverage: {
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/*.spec.{ts,tsx}",
        "*.config.{js,mjs,cjs,ts,mts,cts}",
        ".react-router/**",
        "build/**",
        "coverage/**",
        "dist/**",
        "node_modules/**",
        "tests/**",
      ],
      include: resolveCoverageInclude(testScope),
      provider: "v8",
      reportOnFailure: true,
      reporter: ["text", "html", "json"],
      thresholds: {
        100: true,
        perFile: true,
      },
    },
  },
});
