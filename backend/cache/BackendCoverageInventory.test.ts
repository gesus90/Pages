import path from "node:path";

import { expect, it } from "vitest";

import { buildBackendCoverageInventory } from "../../scripts/backend-coverage-report";

it("inventories only configured sections and distinguishes complete, partial and missing measurements", () => {
  const root = process.cwd();
  const complete = { total: 1, covered: 1, pct: 100 };
  const empty = { total: 0, covered: 0, pct: 100 };
  const partial = { total: 1, covered: 0, pct: 0 };
  const summary = {
    [path.resolve(root, "backend/cache/ServerCache.ts")]: {
      statements: complete,
      branches: empty,
      functions: complete,
      lines: complete,
    },
    [path.resolve(root, "backend/github/GitHubApiClient.ts")]: {
      statements: complete,
      branches: partial,
      functions: complete,
      lines: complete,
    },
  };
  const entries = buildBackendCoverageInventory(root, summary);
  const emptySummary = {
    [path.resolve(root, "backend/setup/SetupService.ts")]: {
      statements: empty,
      branches: empty,
      functions: empty,
      lines: empty,
    },
  };
  const emptyEntries = buildBackendCoverageInventory(root, emptySummary);
  expect(
    emptyEntries.find((entry) => entry.file.endsWith("SetupService.ts"))
      ?.status,
  ).toBe("missing");
  expect(
    entries.filter((entry) => entry.section === "first-section"),
  ).toHaveLength(7);
  expect(
    entries.filter((entry) => entry.section === "second-section"),
  ).toHaveLength(19);
  expect(
    entries.filter((entry) => entry.section === "third-section"),
  ).toHaveLength(50);
  expect(
    entries.filter((entry) => entry.section === "fourth-section"),
  ).toHaveLength(32);
  expect(
    entries.filter((entry) => entry.section === "fifth-section"),
  ).toHaveLength(30);
  expect(
    entries.some((entry) => entry.file === "backend/storage/StreamDigest.ts"),
  ).toBe(true);
  expect(
    entries.find((entry) => entry.file === "backend/storage/StreamDigest.ts")
      ?.status,
  ).toBe("missing");
  expect(
    entries.find((entry) => entry.file.endsWith("ServerCache.ts"))?.status,
  ).toBe("covered");
  expect(
    entries.find((entry) => entry.file.endsWith("GitHubApiClient.ts"))?.status,
  ).toBe("open");
  expect(
    entries.find((entry) => entry.file.endsWith("SetupService.ts"))?.status,
  ).toBe("missing");
});
