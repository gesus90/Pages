import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test as base } from "@playwright/test";

import { STATE_DIRECTORY_VARIABLE } from "./paths";

import type { SeedData } from "./seed";

/** Requests of a page that could change data. */
export interface WriteRecorder {
  /** `METHOD /path` of every request that is not a read. */
  readonly requests: readonly string[];
}

interface BrowserFixtures {
  /** Whose session the page carries. */
  readonly account: "admin" | "reader";
  readonly seed: SeedData;
  readonly writes: WriteRecorder;
}

function stateDirectory(): string {
  const directory = process.env[STATE_DIRECTORY_VARIABLE];

  if (!directory) {
    throw new Error("The global setup did not provide the seed directory.");
  }

  return directory;
}

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Playwright's `test` with the seeded instance.
 *
 * @remarks
 * `account` picks the signed-in person (`test.use({ account: "reader" })`).
 * `seed` describes the fixture tickets. `writes` lists every request of the
 * page that is not a plain read, so a test can prove that looking at an image
 * wrote nothing.
 */
export const test = base.extend<BrowserFixtures>({
  account: ["admin", { option: true }],
  seed: async ({}, use) => {
    const text = readFileSync(path.join(stateDirectory(), "seed.json"), "utf8");

    // The file was written by the global setup of this run.
    await use(JSON.parse(text) as SeedData);
  },
  storageState: async ({ account }, use) => {
    await use(path.join(stateDirectory(), `${account}.json`));
  },
  writes: async ({ page }, use) => {
    const requests: string[] = [];

    page.on("request", (request) => {
      if (!READ_METHODS.has(request.method())) {
        requests.push(`${request.method()} ${new URL(request.url()).pathname}`);
      }
    });
    await use({ requests });
  },
});

export { expect };
