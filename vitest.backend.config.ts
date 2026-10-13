import { defineConfig, mergeConfig } from "vitest/config";

import sharedConfig from "./vitest.shared.config";

/** Node unit scope, including server exports of mixed React Router modules. */
export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      name: "pages-backend-unit",
      environment: "node",
      include: ["tests/backend/**/*.unit.test.{ts,tsx}"],
      coverage: {
        include: [
          "backend/**/*.ts",
          "app/**/*.server.{ts,tsx}",
          "app/lib/**/*.{ts,tsx}",
          "app/routes/**/*.{ts,tsx}",
          "app/root.tsx",
          "app/routes.ts",
          "definition/**/*.ts",
          "language/**/*.ts",
        ],
        reportsDirectory: "coverage/backend",
      },
    },
  }),
);
