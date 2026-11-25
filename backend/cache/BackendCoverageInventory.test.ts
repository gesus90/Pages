import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, it } from "vitest";

import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";

import {
  buildBackendCoverageInventory,
  collectBackendCoverageSources,
} from "../../scripts/backend-coverage-report";
import {
  FIFTH_SECTION_COVERAGE_GLOB,
  FIRST_SECTION_COVERAGE_GLOB,
  FOURTH_SECTION_COVERAGE_GLOB,
  SECOND_SECTION_COVERAGE_GLOB,
  THIRD_SECTION_COVERAGE_GLOB,
} from "../../vitest.backend.config";

it("distinguishes coverage statuses for sources in the configured scope", async () => {
  const parent = pagesTempDirectory("backend-coverage-inventory-tests");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "case-"));

  const executableSource = "export function run() { return true; }";
  const sources = {
    "backend/cache/ServerCache.ts": executableSource,
    "backend/github/GitHubApiClient.ts": executableSource,
    "backend/storage/StreamDigest.ts": executableSource,
    "backend/setup/SetupService.ts": executableSource,
    "backend/error/AgentAuthorizationError.ts":
      "export class AgentAuthorizationError extends Error {}",
    "backend/error/PicaAuthorizationError.ts":
      "export class PicaAuthorizationError extends Error {}",
    "backend/service/chat/OutsideScope.ts": executableSource,
  };
  const complete = { total: 1, covered: 1, pct: 100 };
  const empty = { total: 0, covered: 0, pct: 100 };
  const partial = { total: 1, covered: 0, pct: 0 };
  const coveredMetrics = {
    statements: complete,
    branches: empty,
    functions: complete,
    lines: complete,
  };
  const emptyMetrics = {
    statements: empty,
    branches: empty,
    functions: empty,
    lines: empty,
  };

  try {
    for (const [file, source] of Object.entries(sources)) {
      const destination = path.join(root, file);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, source);
    }

    const entries = buildBackendCoverageInventory(root, {
      [path.join(root, "backend/cache/ServerCache.ts")]: coveredMetrics,
      [path.join(root, "backend/github/GitHubApiClient.ts")]: {
        ...coveredMetrics,
        branches: partial,
      },
      [path.join(root, "backend/setup/SetupService.ts")]: emptyMetrics,
      [path.join(root, "backend/error/AgentAuthorizationError.ts")]:
        emptyMetrics,
      [path.join(root, "backend/service/chat/OutsideScope.ts")]: coveredMetrics,
    });

    expect(
      Object.fromEntries(entries.map(({ file, status }) => [file, status])),
    ).toEqual({
      "backend/cache/ServerCache.ts": "covered",
      "backend/github/GitHubApiClient.ts": "open",
      "backend/storage/StreamDigest.ts": "missing",
      "backend/setup/SetupService.ts": "missing",
      "backend/error/AgentAuthorizationError.ts": "not-applicable",
      "backend/error/PicaAuthorizationError.ts": "missing",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("collects the expected coverage sources from the checkout", () => {
  const sources = collectBackendCoverageSources(process.cwd());
  const expectedSectionCounts = [
    [FIRST_SECTION_COVERAGE_GLOB, 7],
    [SECOND_SECTION_COVERAGE_GLOB, 19],
    [THIRD_SECTION_COVERAGE_GLOB, 50],
    [FOURTH_SECTION_COVERAGE_GLOB, 32],
    [FIFTH_SECTION_COVERAGE_GLOB, 31],
  ] as const;

  for (const [include, count] of expectedSectionCounts) {
    expect(
      sources.filter((file) => path.matchesGlob(file, include)),
    ).toHaveLength(count);
  }
  expect(sources).toContain("backend/storage/StreamDigest.ts");
});
