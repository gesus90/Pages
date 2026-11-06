import { defineConfig, mergeConfig } from "vitest/config";

import sharedConfig from "./vitest.shared.config";

/** Simulated DOM unit scope; resource routes and server modules stay in Node. */
export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      name: "pages-frontend-unit",
      environment: "jsdom",
      include: ["tests/frontend/**/*.unit.test.{ts,tsx}"],
      setupFiles: ["tests/frontend/setup.ts"],
      coverage: {
        include: [
          "app/components/**/*.{ts,tsx}",
          "app/lib/**/*.{ts,tsx}",
          "app/routes/**/*.tsx",
          "app/root.tsx",
          "app/routes.ts",
          "definition/**/*.ts",
          "language/**/*.ts",
        ],
        exclude: ["app/**/*.server.{ts,tsx}"],
        reportsDirectory: "coverage/frontend",
      },
    },
  }),
);
