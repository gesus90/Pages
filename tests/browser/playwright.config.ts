import path from "node:path";

import { defineConfig } from "@playwright/test";

import { INSTANCE_ORIGIN } from "./support/paths";

const RESULTS =
  process.env.PAGES_BROWSER_RESULTS ??
  path.join(import.meta.dirname, "results");

const DESKTOP = { height: 900, width: 1440 };
const MOBILE = { height: 844, width: 390 };

/**
 * Browser suite of the Pages ticket image viewer (PAGE-172).
 *
 * It starts its own Pages instance from the production build, with its own
 * database and synthetic accounts, and drives it with a real Chromium. The
 * unit suites are untouched by it: nothing here is discovered by Vitest.
 */
export default defineConfig({
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      // No pixel may differ visibly. The images are flat colors with hard
      // edges and the text is drawn by the same Chromium and fonts, so a run
      // is reproducible; `threshold` only ignores sub-visible color noise of
      // anti-aliasing, and even a single missing control is far more than that.
      maxDiffPixels: 0,
      scale: "css",
      threshold: 0.1,
    },
  },
  forbidOnly: true,
  fullyParallel: false,
  globalSetup: "./support/global-setup.ts",
  outputDir: path.join(RESULTS, "artifacts"),
  projects: [
    {
      name: "desktop-light",
      testIgnore: "**/*.mobile.spec.ts",
      use: { colorScheme: "light", viewport: DESKTOP },
    },
    {
      name: "desktop-dark",
      testMatch: "**/*.visual.spec.ts",
      use: { colorScheme: "dark", viewport: DESKTOP },
    },
    {
      name: "mobile-light",
      testMatch: ["**/*.visual.spec.ts", "**/*.mobile.spec.ts"],
      use: {
        colorScheme: "light",
        hasTouch: true,
        isMobile: true,
        viewport: MOBILE,
      },
    },
    {
      name: "mobile-dark",
      testMatch: "**/*.visual.spec.ts",
      use: {
        colorScheme: "dark",
        hasTouch: true,
        isMobile: true,
        viewport: MOBILE,
      },
    },
  ],
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: path.join(RESULTS, "report") }],
  ],
  retries: 0,
  snapshotPathTemplate:
    "{testDir}/../__screenshots__/{testFileName}/{arg}-{projectName}-{platform}{ext}",
  testDir: "./specs",
  timeout: 60_000,
  use: {
    baseURL: INSTANCE_ORIGIN,
    locale: "en-US",
    reducedMotion: "reduce",
    screenshot: "only-on-failure",
    serviceWorkers: "block",
    timezoneId: "UTC",
    trace: "retain-on-failure",
  },
  workers: 1,
});
