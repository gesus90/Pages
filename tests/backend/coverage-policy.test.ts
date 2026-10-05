import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import vitestConfig from "../../vitest.config";

const REPOSITORY_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCANNED_DIRECTORIES = [
  "app",
  "backend",
  "definition",
  "language",
  "tests",
];
const SCANNED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const COVERAGE_IGNORE_COMMENT = /\b(?:v8|istanbul|c8)\s+ignore\b/;
const THIS_FILE = path.relative(
  REPOSITORY_ROOT,
  fileURLToPath(import.meta.url),
);

// Coverage is not weakened by excluding more files: every entry below is
// tooling output, a test, or a configuration file rather than source code.
const ALLOWED_COVERAGE_EXCLUDES = [
  "**/*.test.{ts,tsx}",
  "**/*.spec.{ts,tsx}",
  "*.config.{js,mjs,cjs,ts,mts,cts}",
  ".react-router/**",
  "build/**",
  "coverage/**",
  "dist/**",
  "node_modules/**",
  "tests/**",
];

function listScannedFiles(): string[] {
  const rootFiles = readdirSync(REPOSITORY_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  const nestedFiles = SCANNED_DIRECTORIES.filter((directory) =>
    existsSync(path.join(REPOSITORY_ROOT, directory)),
  ).flatMap((directory) =>
    readdirSync(path.join(REPOSITORY_ROOT, directory), {
      recursive: true,
    }).map((file) => path.join(directory, file.toString())),
  );

  return [...rootFiles, ...nestedFiles].filter(
    (file) => SCANNED_EXTENSIONS.has(path.extname(file)) && file !== THIS_FILE,
  );
}

describe("coverage policy", () => {
  it("forbids coverage ignore comments in every source and test file", () => {
    const offendingFiles = listScannedFiles().filter((file) =>
      COVERAGE_IGNORE_COMMENT.test(
        readFileSync(path.join(REPOSITORY_ROOT, file), "utf8"),
      ),
    );

    expect(offendingFiles).toEqual([]);
  });

  it("requires 100 percent coverage for every file", () => {
    expect(vitestConfig.test?.coverage?.thresholds).toEqual({
      100: true,
      perFile: true,
    });
  });

  it("does not exclude further files from coverage", () => {
    expect(vitestConfig.test?.coverage?.exclude).toEqual(
      ALLOWED_COVERAGE_EXCLUDES,
    );
  });
});
