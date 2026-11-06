import { expect, it } from "vitest";

import {
  isFingerprintedFile,
  isGeneratedDirectory,
  isSourceFile,
} from "@/scripts/source-population.mjs";

it.each([
  "node_modules",
  "coverage",
  "backend/x/dist",
  ".git",
  "build",
  ".react-router",
])("classifies the directory %s as generated", (directory) => {
  expect(isGeneratedDirectory(directory)).toBe(true);
});

it.each(["backend/service/mobile", "backend/build", "tests/browser", "data"])(
  "keeps the directory %s",
  (directory) => {
    expect(isGeneratedDirectory(directory)).toBe(false);
  },
);

it.each(["a.js", "a.mjs", "a.cjs", "a.ts", "a.mts", "a.cts", "a.tsx"])(
  "treats %s as source",
  (file) => {
    expect(isSourceFile(file)).toBe(true);
  },
);

it("treats other file types as no lintable source", () => {
  expect(isSourceFile("README.md")).toBe(false);
});

it.each([
  "backend/A.ts",
  "README.md",
  ".env.example",
  "data/seed.ts",
  "Results/kept.ts",
  ".claude/hook.mjs",
  "docs/x.md",
])("fingerprints %s", (file) => {
  expect(isFingerprintedFile(file)).toBe(true);
});

it.each([
  ".env",
  ".env.local",
  "deep/.env.production",
  "server.log",
  "data/pages.duckdb",
  "Results/report.md",
  ".claude/scheduled_tasks.lock",
  "tests/browser/results/report/index.html",
  "tests/browser/results/report/trace/generated.js",
])("leaves the local or generated file %s out", (file) => {
  expect(isFingerprintedFile(file)).toBe(false);
});
