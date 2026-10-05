import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readMigrationFiles } from "@/backend/database/MigrationFiles";

describe("readMigrationFiles", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "pages-migrations-"));
  });

  afterEach(async () => {
    await rm(directory, { force: true, recursive: true });
  });

  it("returns the SQL files in file-name order with their content", async () => {
    await writeFile(path.join(directory, "002_second.sql"), "SELECT 2;");
    await writeFile(path.join(directory, "001_first.sql"), "SELECT 1;");

    await expect(readMigrationFiles(directory)).resolves.toEqual([
      { name: "001_first.sql", sql: "SELECT 1;" },
      { name: "002_second.sql", sql: "SELECT 2;" },
    ]);
  });

  it("skips other files and directories", async () => {
    await writeFile(path.join(directory, "001_first.sql"), "SELECT 1;");
    await writeFile(path.join(directory, "notes.md"), "not a migration");
    await mkdir(path.join(directory, "archive.sql"));

    const migrations = await readMigrationFiles(directory);

    expect(migrations.map((migration) => migration.name)).toEqual([
      "001_first.sql",
    ]);
  });

  it("rejects a directory that does not exist", async () => {
    await expect(
      readMigrationFiles(path.join(directory, "missing")),
    ).rejects.toThrow("ENOENT");
  });
});
