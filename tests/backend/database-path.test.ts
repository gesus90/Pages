import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import path from "node:path";

import { createLegacyDatabaseWarning } from "@/backend/database/DatabasePath";

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
