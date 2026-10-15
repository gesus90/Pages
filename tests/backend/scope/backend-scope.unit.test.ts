import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import backendConfig from "../../../vitest.backend.config";

/**
 * Guards the scope rule of `pnpm run test:backend`.
 *
 * The suite reads the repository's own test sources and manifests only. It
 * opens no database, starts no process and imports no application module.
 */
const REPOSITORY_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const BACKEND_TESTS = path.join(REPOSITORY_ROOT, "tests", "backend");
const IMPORT_PATTERN =
  /(?:\bfrom\s+|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)["']([^"']+)["']/gu;

function discoveryPatterns(): string[] {
  const include: unknown = backendConfig.test?.include;
  if (!Array.isArray(include)) throw new Error("Expected discovery patterns.");
  return include.map((pattern: unknown) => {
    if (typeof pattern !== "string") throw new Error("Expected a glob string.");
    return pattern;
  });
}

function listFiles(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

function readImports(file: string): string[] {
  const source = readFileSync(file, "utf8");

  return [...source.matchAll(IMPORT_PATTERN)].map((match) => match[1]);
}

function resolvesInto(file: string, specifier: string, area: string): boolean {
  const target = specifier.startsWith(".")
    ? path.resolve(path.dirname(file), specifier)
    : path.resolve(REPOSITORY_ROOT, specifier.replace(/^@\//u, ""));

  return target === area || target.startsWith(`${area}${path.sep}`);
}

function readManifestScripts(): Record<string, string> {
  const manifest: unknown = JSON.parse(
    readFileSync(path.join(REPOSITORY_ROOT, "package.json"), "utf8"),
  );

  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !("scripts" in manifest) ||
    typeof manifest.scripts !== "object" ||
    manifest.scripts === null
  ) {
    throw new Error("package.json has no scripts.");
  }

  return Object.fromEntries(Object.entries(manifest.scripts));
}

describe("test:backend command", () => {
  const scripts = readManifestScripts();

  it("runs exactly the backend configuration with coverage", () => {
    expect(scripts["test:backend"]).toBe(
      "vitest run --config vitest.backend.config.ts --coverage",
    );
  });

  it("has no general or aggregate test script", () => {
    expect(Object.keys(scripts).filter((name) => /^test/u.test(name))).toEqual([
      "test:backend",
      "test:frontend",
    ]);
    expect(scripts.test).toBeUndefined();
  });

  it("keeps the frontend and MCP scopes out of the backend script", () => {
    expect(scripts["test:backend"]).not.toMatch(/frontend|mcp|playwright/u);
    expect(scripts["test:frontend"]).not.toMatch(/backend|mcp/u);
  });
});

describe("backend discovery", () => {
  it("selects unit test files below tests/backend in Node only", () => {
    expect(backendConfig.test?.include).toEqual([
      "tests/backend/**/*.unit.test.{ts,tsx}",
    ]);
    expect(backendConfig.test?.environment).toBe("node");
    expect(backendConfig.test?.name).toBe("pages-backend-unit");
  });

  it("does not select the frontend tree, the MCP package or other test kinds", () => {
    const include = JSON.stringify(backendConfig.test?.include);

    expect(include).not.toMatch(/frontend|mcp|e2e|integration|smoke|live/u);
    expect(backendConfig.test?.setupFiles ?? []).toEqual([]);
  });

  it("writes its report only to the backend coverage directory", () => {
    expect(backendConfig.test?.coverage?.reportsDirectory).toBe(
      "coverage/backend",
    );
  });

  it.each([
    ["tests/backend/new/service.unit.test.ts", true],
    ["tests/backend/app/routes/new.unit.test.tsx", true],
    ["tests/backend/new/service.integration.test.ts", false],
    ["tests/backend/new/service.e2e.test.ts", false],
    ["tests/backend/new/service.smoke.test.ts", false],
    ["tests/backend/new/service.live.test.ts", false],
    ["tests/backend/new/service.browser.test.ts", false],
    ["tests/backend/new/service.test.ts", false],
    ["tests/backend/new/fixture.ts", false],
    ["tests/frontend/new/component.unit.test.tsx", false],
    ["mcp/tests/new.unit.test.ts", false],
    ["backend/new/service.unit.test.ts", false],
  ])("selects %s: %s", (file, isSelected) => {
    const matches = discoveryPatterns().some((pattern) =>
      path.matchesGlob(file, pattern),
    );

    expect(matches).toBe(isSelected);
  });
});

describe("backend test boundaries", () => {
  const testFiles = listFiles(BACKEND_TESTS).filter((file) =>
    /\.tsx?$/u.test(file),
  );

  it("finds the test sources to inspect", () => {
    expect(testFiles.length).toBeGreaterThan(0);
  });

  it("never imports the independent MCP package", () => {
    const offenders = testFiles.flatMap((file) =>
      readImports(file)
        .filter((specifier) =>
          resolvesInto(file, specifier, path.join(REPOSITORY_ROOT, "mcp")),
        )
        .map(
          (specifier) =>
            `${path.relative(REPOSITORY_ROOT, file)}: ${specifier}`,
        ),
    );

    expect(offenders).toEqual([]);
  });

  it("never imports the frontend test tree", () => {
    const offenders = testFiles.flatMap((file) =>
      readImports(file)
        .filter((specifier) =>
          resolvesInto(
            file,
            specifier,
            path.join(REPOSITORY_ROOT, "tests", "frontend"),
          ),
        )
        .map(
          (specifier) =>
            `${path.relative(REPOSITORY_ROOT, file)}: ${specifier}`,
        ),
    );

    expect(offenders).toEqual([]);
  });

  it("imports no MCP transport or browser runner", () => {
    const offenders = testFiles
      .filter((file) => !file.endsWith("backend-scope.unit.test.ts"))
      .flatMap((file) =>
        readImports(file)
          .filter((specifier) =>
            /^@modelcontextprotocol\/|^playwright|^puppeteer|^@playwright\//u.test(
              specifier,
            ),
          )
          .map(
            (specifier) =>
              `${path.relative(REPOSITORY_ROOT, file)}: ${specifier}`,
          ),
      );

    expect(offenders).toEqual([]);
  });
});
