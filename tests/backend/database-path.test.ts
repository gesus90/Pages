import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();

  return {
    ...actual,
    homedir: vi.fn(() => "/mocked/home"),
  };
});

import { homedir } from "node:os";
import path from "node:path";

import { resolveDatabasePath } from "@/backend/database/DatabasePath";

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
