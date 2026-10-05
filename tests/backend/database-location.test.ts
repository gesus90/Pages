import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/backend/database/PagesDatabaseInspector", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/backend/database/PagesDatabaseInspector")
    >();

  return { inspectPagesDatabase: vi.fn(actual.inspectPagesDatabase) };
});

import { inspectPagesDatabase } from "@/backend/database/PagesDatabaseInspector";
import {
  checkDatabaseLocation,
  normalizeDatabasePath,
} from "@/backend/setup/DatabaseLocation";

import { createPagesDatabaseFile } from "../helpers/pages-database-file";

describe("normalizeDatabasePath", () => {
  it("accepts absolute paths of .duckdb files and normalizes them", () => {
    expect(normalizeDatabasePath("/srv//pages/../pages/Data.DUCKDB")).toBe(
      "/srv/pages/Data.DUCKDB",
    );
  });

  it("expands the home directory", () => {
    expect(normalizeDatabasePath("~/db/pages.duckdb")).toBe(
      path.join(homedir(), "db", "pages.duckdb"),
    );
  });

  it.each([
    "relative/pages.duckdb",
    "~user/pages.duckdb",
    "/srv/pages.db",
    "/srv/pages.duckdb/",
    "/srv/.duckdb",
    "/srv/pages",
    "/srv/pa\0ges.duckdb",
    `/${"a".repeat(4096)}.duckdb`,
  ])("rejects %j", (input) => {
    expect(normalizeDatabasePath(input)).toBeNull();
  });
});

describe("checkDatabaseLocation", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "pages-location-"));
  });

  afterEach(async () => {
    await chmod(directory, 0o700);
    await rm(directory, { force: true, recursive: true });
  });

  async function check(input: string): Promise<string> {
    return (await checkDatabaseLocation(input)).status;
  }

  it("asks for a path when nothing was entered", async () => {
    await expect(checkDatabaseLocation("  ")).resolves.toEqual({
      databasePath: null,
      status: "empty",
    });
  });

  it("rejects text that is no database path", async () => {
    await expect(checkDatabaseLocation("pages.duckdb")).resolves.toEqual({
      databasePath: null,
      status: "invalid",
    });
  });

  it("offers a free path in a writable directory", async () => {
    await expect(
      checkDatabaseLocation(` ${directory}/sub/../pages.duckdb `),
    ).resolves.toEqual({
      databasePath: path.join(directory, "pages.duckdb"),
      status: "available",
    });
    expect(await readdir(directory)).toEqual([]);
  });

  it("rejects missing, unwritable, and non-directory parents", async () => {
    await writeFile(path.join(directory, "file"), "");
    await mkdir(path.join(directory, "locked"));
    await chmod(path.join(directory, "locked"), 0o500);

    expect(await check(`${directory}/missing/pages.duckdb`)).toBe(
      "notWritable",
    );
    expect(await check(`${directory}/file/pages.duckdb`)).toBe("notWritable");
    expect(await check(`${directory}/locked/pages.duckdb`)).toBe("notWritable");

    await chmod(path.join(directory, "locked"), 0o700);
  });

  it("opens an existing Pages database, also through a link", async () => {
    const databasePath = path.join(directory, "pages.duckdb");

    await createPagesDatabaseFile(databasePath);
    await symlink(databasePath, path.join(directory, "link.duckdb"));

    expect(await check(databasePath)).toBe("existing");
    expect(await check(`${directory}/link.duckdb`)).toBe("existing");
  });

  it("never offers a foreign file, a directory, or a broken link", async () => {
    await writeFile(path.join(directory, "other.duckdb"), "my notes");
    await mkdir(path.join(directory, "folder.duckdb"));
    await symlink(
      path.join(directory, "missing"),
      path.join(directory, "broken.duckdb"),
    );

    expect(await check(`${directory}/other.duckdb`)).toBe("foreign");
    expect(await check(`${directory}/folder.duckdb`)).toBe("foreign");
    expect(await check(`${directory}/broken.duckdb`)).toBe("foreign");
  });

  it("reports a database file Pages cannot write or another process holds", async () => {
    const readOnly = path.join(directory, "readonly.duckdb");
    const busy = path.join(directory, "busy.duckdb");

    await writeFile(readOnly, "");
    await chmod(readOnly, 0o400);
    await createPagesDatabaseFile(busy);
    vi.mocked(inspectPagesDatabase).mockResolvedValueOnce({ kind: "locked" });

    expect(await check(readOnly)).toBe("notWritable");
    expect(await check(busy)).toBe("notWritable");
  });
});
