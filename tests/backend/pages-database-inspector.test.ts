import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { DuckDBInstance } from "@duckdb/node-api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { inspectPagesDatabase } from "@/backend/database/PagesDatabaseInspector";

import { createPagesDatabaseFile } from "../helpers/pages-database-file";

async function createDuckDbFile(
  filePath: string,
  statements: readonly string[],
): Promise<void> {
  const instance = await DuckDBInstance.create(filePath);
  const connection = await instance.connect();

  for (const statement of statements) {
    await connection.run(statement);
  }

  connection.closeSync();
  instance.closeSync();
}

describe("inspectPagesDatabase", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "pages-inspect-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(directory, { force: true, recursive: true });
  });

  it("recognizes a Pages database with an active administrator", async () => {
    const filePath = path.join(directory, "pages.duckdb");

    await createPagesDatabaseFile(filePath, {
      users: [{ id: "u1", username: "chef" }],
    });

    await expect(inspectPagesDatabase(filePath)).resolves.toEqual({
      hasActiveAdministrator: true,
      kind: "pages",
    });
  });

  it("recognizes a Pages database without an active administrator", async () => {
    const filePath = path.join(directory, "pages.duckdb");

    await createPagesDatabaseFile(filePath, {
      users: [
        { id: "u1", isActive: false, username: "alt" },
        { id: "u2", role: "employee", username: "team" },
      ],
    });

    await expect(inspectPagesDatabase(filePath)).resolves.toEqual({
      hasActiveAdministrator: false,
      kind: "pages",
    });
  });

  it("treats other DuckDB databases as foreign", async () => {
    const empty = path.join(directory, "empty.duckdb");
    const lookalike = path.join(directory, "lookalike.duckdb");

    await createDuckDbFile(empty, ["CREATE TABLE notes (text TEXT);"]);
    await createDuckDbFile(lookalike, [
      "CREATE TABLE schema_migrations (name TEXT);",
      "CREATE TABLE users (id TEXT);",
      "INSERT INTO schema_migrations VALUES ('001_other.sql');",
    ]);

    await expect(inspectPagesDatabase(empty)).resolves.toEqual({
      kind: "foreign",
    });
    await expect(inspectPagesDatabase(lookalike)).resolves.toEqual({
      kind: "foreign",
    });
  });

  it("treats files that are no DuckDB database as foreign and leaves them alone", async () => {
    const filePath = path.join(directory, "notes.duckdb");

    await writeFile(filePath, "SQLite format 3\0 not a duckdb file");

    await expect(inspectPagesDatabase(filePath)).resolves.toEqual({
      kind: "foreign",
    });
  });

  it("reports a file another process holds open", async () => {
    vi.spyOn(DuckDBInstance, "create").mockRejectedValue(
      new Error('IO Error: Could not set lock on file "x": Conflicting lock'),
    );

    await expect(inspectPagesDatabase("/any.duckdb")).resolves.toEqual({
      kind: "locked",
    });
  });

  it("treats a database that fails while reading as foreign", async () => {
    const closeSync = vi.fn();

    vi.spyOn(DuckDBInstance, "create").mockResolvedValue({
      closeSync,
      connect: vi.fn().mockRejectedValue(new Error("broken")),
    } as unknown as DuckDBInstance);

    await expect(inspectPagesDatabase("/any.duckdb")).resolves.toEqual({
      kind: "foreign",
    });
    expect(closeSync).toHaveBeenCalledTimes(1);
  });
});
