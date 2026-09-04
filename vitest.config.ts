import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vitest/config";

const projectAlias = {
  "@": fileURLToPath(new URL(".", import.meta.url)),
};

export default defineConfig({
  resolve: {
    alias: projectAlias,
  },
  test: {
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    coverage: {
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/*.spec.{ts,tsx}",
        "tests/**",
        "build/**",
        ".react-router/**",
        "node_modules/**",
        "vite.config.ts",
        "react-router.config.ts",
        "vitest.config.ts",
      ],
      include: [
        "app/**/*.{ts,tsx}",
        "backend/**/*.ts",
        "definition/**/*.ts",
        "language/**/*.ts",
      ],
      provider: "v8",
      reportOnFailure: true,
      reporter: ["text", "html", "json"],
      thresholds: {
        100: true,
        perFile: true,
      },
    },
    projects: [
      {
        resolve: {
          alias: projectAlias,
        },
        test: {
          environment: "jsdom",
          include: ["tests/frontend/**/*.test.{ts,tsx}"],
          name: "frontend",
          setupFiles: ["tests/frontend/setup.ts"],
        },
      },
      {
        resolve: {
          alias: projectAlias,
        },
        test: {
          environment: "node",
          include: ["tests/backend/**/*.test.ts"],
          name: "backend",
        },
      },
    ],
  },
});
