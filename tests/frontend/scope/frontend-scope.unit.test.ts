import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../../..");
const TEST_ROOT = path.join(REPOSITORY_ROOT, "tests", "frontend");
const IMPORT_PATTERN =
  /(?:\bfrom\s+|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)["']([^"']+)["']/gu;

const frontendSource = readFileSync(
  path.join(REPOSITORY_ROOT, "vitest.frontend.config.ts"),
  "utf8",
);
const sharedSource = readFileSync(
  path.join(REPOSITORY_ROOT, "vitest.shared.config.ts"),
  "utf8",
);

function patterns(): string[] {
  // Read the discovery literal without loading Vite/esbuild into jsdom's realm.
  const include = /include:\s*\[([^\]]+)\]/u.exec(frontendSource)?.[1];
  if (!include) throw new Error("Expected discovery patterns");
  return [...include.matchAll(/"([^"]+)"/gu)].map((match) => match[1]);
}

function listSources(): string[] {
  return readdirSync(TEST_ROOT, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/u.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

function forbiddenImport(file: string, specifier: string): boolean {
  const target = specifier.startsWith(".")
    ? path.resolve(path.dirname(file), specifier)
    : path.resolve(REPOSITORY_ROOT, specifier.replace(/^@\//u, ""));
  return (
    ["mcp", "tests/backend"].some((area) => {
      const root = path.resolve(REPOSITORY_ROOT, area);
      return target === root || target.startsWith(`${root}${path.sep}`);
    }) ||
    /^(?:@modelcontextprotocol\/|playwright|@playwright\/|puppeteer|node:child_process$)/u.test(
      specifier,
    )
  );
}

describe("frontend command and discovery", () => {
  it("keeps exactly two standalone Pages unit scripts with coverage", () => {
    const manifest: unknown = JSON.parse(
      readFileSync(path.join(REPOSITORY_ROOT, "package.json"), "utf8"),
    );
    if (
      typeof manifest !== "object" ||
      manifest === null ||
      !("scripts" in manifest) ||
      typeof manifest.scripts !== "object" ||
      manifest.scripts === null
    )
      throw new Error("Expected scripts");
    const scripts = Object.fromEntries(Object.entries(manifest.scripts));
    expect(
      Object.keys(scripts).filter((name) => name.startsWith("test")),
    ).toEqual(["test:backend", "test:frontend"]);
    expect(scripts.test).toBeUndefined();
    expect(scripts["test:frontend"]).toBe(
      "vitest run --config vitest.frontend.config.ts --coverage",
    );
    expect(scripts["test:frontend"]).not.toMatch(
      /backend|mcp|browser|e2e|integration/u,
    );
  });

  it("uses only jsdom frontend units and its own cleanup and report directory", () => {
    expect(patterns()).toEqual(["tests/frontend/**/*.unit.test.{ts,tsx}"]);
    expect(frontendSource).toMatch(/environment: "jsdom"/u);
    expect(frontendSource).toMatch(/name: "pages-frontend-unit"/u);
    expect(frontendSource).toMatch(
      /setupFiles: \["tests\/frontend\/setup\.ts"\]/u,
    );
    expect(frontendSource).toMatch(/reportsDirectory: "coverage\/frontend"/u);
    expect(sharedSource).toMatch(/passWithNoTests: false/u);
    expect(frontendSource).not.toMatch(/browser:|thresholds:/u);
    expect(sharedSource).not.toMatch(/browser:|thresholds:/u);
    expect(frontendSource).toMatch(
      /exclude: \["app\/\*\*\/\*\.server\.\{ts,tsx\}"\]/u,
    );
  });

  it.each([
    ["tests/frontend/new/component.unit.test.tsx", true],
    ["tests/frontend/new/use-state.unit.test.ts", true],
    ["tests/frontend/new/component.test.tsx", false],
    ["tests/frontend/new/component.spec.tsx", false],
    ["tests/frontend/new/component.integration.test.tsx", false],
    ["tests/frontend/new/component.browser.test.tsx", false],
    ["tests/frontend/new/component.e2e.test.tsx", false],
    ["tests/frontend/new/component.smoke.test.tsx", false],
    ["tests/frontend/new/component.live.test.tsx", false],
    ["tests/frontend/new/fixture.tsx", false],
    ["tests/backend/new/route.unit.test.tsx", false],
    ["tests/e2e/component.unit.test.tsx", false],
    ["mcp/tests/component.unit.test.ts", false],
    ["app/components/new.unit.test.tsx", false],
  ])("selects %s: %s", (file, isSelected) => {
    expect(patterns().some((pattern) => path.matchesGlob(file, pattern))).toBe(
      isSelected,
    );
  });
});

it("keeps all frontend test sources and fixtures outside executable MCP, backend tests and process runners", () => {
  const sources = listSources();
  expect(sources.length).toBeGreaterThan(0);
  const offenders = sources.flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(IMPORT_PATTERN)]
      .map((match) => match[1])
      .filter((specifier) => forbiddenImport(file, specifier))
      .map(
        (specifier) => `${path.relative(REPOSITORY_ROOT, file)}: ${specifier}`,
      ),
  );
  expect(offenders).toEqual([]);
});
