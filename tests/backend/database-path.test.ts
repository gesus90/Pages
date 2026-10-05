import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();

  return {
    ...actual,
    homedir: vi.fn(() => "/mocked/home"),
  };
});

import { homedir } from "node:os";
import path from "node:path";

import {
  createLegacyDatabaseWarning,
  resolveDatabasePath,
} from "@/backend/database/DatabasePath";

const mockedHomedir = vi.mocked(homedir);

describe("resolveDatabasePath", () => {
  afterEach(() => {
    delete process.env.PAGES_DATABASE_PATH;
    mockedHomedir.mockReset();
    mockedHomedir.mockReturnValue("/mocked/home");
  });

  it("resolves the default database inside the home directory", () => {
    mockedHomedir.mockReturnValue("/home/pages-user");

    expect(resolveDatabasePath()).toBe(
      path.join("/home/pages-user", ".pages", "data", "pages.duckdb"),
    );
  });

  it("builds the default path from directory segments", () => {
    mockedHomedir.mockReturnValue("/home/tester");

    const resolved = resolveDatabasePath();

    expect(resolved.endsWith("pages.duckdb")).toBe(true);
    expect(resolved).toContain(".pages");
    expect(resolved).toContain("data");
  });

  it("prefers an explicitly configured database path", () => {
    process.env.PAGES_DATABASE_PATH = "./custom/pages.duckdb";

    expect(resolveDatabasePath().endsWith("pages.duckdb")).toBe(true);
    expect(resolveDatabasePath()).toContain("custom");
  });

  it("resolves relative configured paths against the working directory", () => {
    process.env.PAGES_DATABASE_PATH = "relative/database.duckdb";

    const resolved = resolveDatabasePath();

    expect(resolved).toContain("relative");
    expect(resolved.endsWith("database.duckdb")).toBe(true);
  });

  it("throws when the home directory cannot be determined", () => {
    mockedHomedir.mockReturnValue("");

    expect(() => resolveDatabasePath()).toThrow(
      "Pages could not determine the home directory of the current user.",
    );
  });
});

describe("createLegacyDatabaseWarning", () => {
  let directory: string;
  let databasePath: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "pages-legacy-"));
    databasePath = path.join(directory, "pages.duckdb");
  });

  afterEach(async () => {
    await rm(directory, { force: true, recursive: true });
  });

  it("names the transfer when only the former SQLite file exists", async () => {
    await writeFile(path.join(directory, "pages.db"), "");

    const warning = createLegacyDatabaseWarning(databasePath);

    expect(warning).toContain(path.join(directory, "pages.db"));
    expect(warning).toContain("pnpm db:transfer");
    expect(warning).toContain(databasePath);
  });

  it("stays silent once the DuckDB file exists", async () => {
    await writeFile(path.join(directory, "pages.db"), "");
    await writeFile(databasePath, "");

    expect(createLegacyDatabaseWarning(databasePath)).toBeNull();
  });

  it("stays silent without a former SQLite file", () => {
    expect(createLegacyDatabaseWarning(databasePath)).toBeNull();
  });

  it("looks next to the configured database file", async () => {
    const nested = path.join(directory, "nested");

    await mkdir(nested);
    await writeFile(path.join(directory, "pages.db"), "");

    expect(
      createLegacyDatabaseWarning(path.join(nested, "pages.duckdb")),
    ).toBeNull();
  });
});
