import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  checkDatabaseLocation,
  normalizeDatabasePath,
} from "@/backend/setup/DatabaseLocation";
import { inspectPagesDatabase } from "@/backend/database/PagesDatabaseInspector";
import {
  canUseDatabaseLocation,
  DATABASE_LOCATION_STATUS as STATUS,
} from "@/definition/Setup";

import type { PagesDatabaseInspection } from "@/backend/database/PagesDatabaseInspector";

interface FakeEntry {
  readonly kind: "file" | "directory" | "link";
  readonly writable?: boolean;
  readonly linkTarget?: FakeEntry | null;
}

const filesystem = vi.hoisted(() => ({
  entries: new Map<string, FakeEntry>(),
}));

vi.mock("node:os", () => ({
  homedir: () => "/home/pages",
  default: { homedir: () => "/home/pages" },
}));
vi.mock("node:fs", () => ({ constants: { R_OK: 4, W_OK: 2, X_OK: 1 } }));
vi.mock("node:fs/promises", () => {
  function entryOf(location: string): FakeEntry {
    const entry = filesystem.entries.get(location);
    if (entry === undefined) {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    }
    return entry;
  }
  function stats(entry: FakeEntry): {
    isDirectory: () => boolean;
    isFile: () => boolean;
    isSymbolicLink: () => boolean;
  } {
    return {
      isDirectory: () => entry.kind === "directory",
      isFile: () => entry.kind === "file",
      isSymbolicLink: () => entry.kind === "link",
    };
  }
  return {
    access: async (location: string) => {
      if (entryOf(location).writable === false) {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      }
    },
    lstat: async (location: string) => stats(entryOf(location)),
    stat: async (location: string) => {
      const entry = entryOf(location);
      if (entry.kind !== "link") return stats(entry);
      if (!entry.linkTarget) throw new Error("ENOENT");
      return stats(entry.linkTarget);
    },
  };
});
vi.mock("@/backend/database/PagesDatabaseInspector", () => ({
  inspectPagesDatabase: vi.fn(),
}));

const DIRECTORY = "/srv/pages";
const DATABASE = "/srv/pages/pages.duckdb";

function setEntries(entries: Record<string, FakeEntry>): void {
  filesystem.entries = new Map(Object.entries(entries));
}

beforeEach(() => {
  setEntries({ [DIRECTORY]: { kind: "directory" } });
  vi.mocked(inspectPagesDatabase).mockReset();
});

describe("normalizeDatabasePath", () => {
  it.each([
    ["/srv/pages/pages.duckdb", "/srv/pages/pages.duckdb"],
    ["/srv/a/../pages/Data.DUCKDB", "/srv/pages/Data.DUCKDB"],
    ["~/pages/pages.duckdb", "/home/pages/pages/pages.duckdb"],
  ])("accepts %s", (input, expected) => {
    expect(normalizeDatabasePath(input)).toBe(expected);
  });

  it.each([
    ["a relative path", "data/pages.duckdb"],
    ["another extension", "/srv/pages/pages.db"],
    ["a bare extension", "/srv/pages/.duckdb"],
    ["a directory", "/srv/pages/"],
    ["a NUL byte", "/srv/pages/\0pages.duckdb"],
    ["an overlong path", `/${"a".repeat(4100)}.duckdb`],
  ])("rejects %s", (_, input) => {
    expect(normalizeDatabasePath(input)).toBeNull();
  });
});

describe("checkDatabaseLocation", () => {
  it("reports an empty input", async () => {
    await expect(checkDatabaseLocation("   ")).resolves.toEqual({
      databasePath: null,
      status: STATUS.EMPTY,
    });
  });

  it("reports an input that is no database path", async () => {
    await expect(checkDatabaseLocation("pages.txt")).resolves.toEqual({
      databasePath: null,
      status: STATUS.INVALID,
    });
  });

  it("offers a free path in a writable directory", async () => {
    const check = await checkDatabaseLocation(` ${DATABASE} `);

    expect(check).toEqual({ databasePath: DATABASE, status: STATUS.AVAILABLE });
    expect(canUseDatabaseLocation(check.status)).toBe(true);
  });

  it.each([
    ["a missing directory", {}],
    [
      "a directory without permission",
      { [DIRECTORY]: { kind: "directory", writable: false } },
    ],
    ["a file instead of a directory", { [DIRECTORY]: { kind: "file" } }],
  ] satisfies [string, Record<string, FakeEntry>][])(
    "refuses %s",
    async (_, entries) => {
      setEntries(entries);

      const check = await checkDatabaseLocation(DATABASE);

      expect(check.status).toBe(STATUS.NOT_WRITABLE);
      expect(canUseDatabaseLocation(check.status)).toBe(false);
    },
  );

  it.each([
    [{ kind: "pages", hasActiveAdministrator: true }, STATUS.EXISTING],
    [{ kind: "foreign" }, STATUS.FOREIGN],
    [{ kind: "locked" }, STATUS.NOT_WRITABLE],
  ] as const)(
    "classifies an existing file by inspection %j",
    async (inspection, status) => {
      setEntries({
        [DIRECTORY]: { kind: "directory" },
        [DATABASE]: { kind: "file" },
      });
      vi.mocked(inspectPagesDatabase).mockResolvedValue(
        inspection satisfies PagesDatabaseInspection,
      );

      const check = await checkDatabaseLocation(DATABASE);

      expect(check.status).toBe(status);
      expect(canUseDatabaseLocation(check.status)).toBe(
        status === STATUS.EXISTING,
      );
    },
  );

  it("never opens a file Pages cannot read and write", async () => {
    setEntries({
      [DIRECTORY]: { kind: "directory" },
      [DATABASE]: { kind: "file", writable: false },
    });

    await expect(checkDatabaseLocation(DATABASE)).resolves.toMatchObject({
      status: STATUS.NOT_WRITABLE,
    });
    expect(inspectPagesDatabase).not.toHaveBeenCalled();
  });

  it("treats a directory or a dangling link at the path as foreign", async () => {
    setEntries({
      [DIRECTORY]: { kind: "directory" },
      [DATABASE]: { kind: "directory" },
    });
    await expect(checkDatabaseLocation(DATABASE)).resolves.toMatchObject({
      status: STATUS.FOREIGN,
    });

    setEntries({
      [DIRECTORY]: { kind: "directory" },
      [DATABASE]: { kind: "link", linkTarget: null },
    });
    await expect(checkDatabaseLocation(DATABASE)).resolves.toMatchObject({
      status: STATUS.FOREIGN,
    });
    expect(inspectPagesDatabase).not.toHaveBeenCalled();
  });

  it("follows a link to a Pages database", async () => {
    setEntries({
      [DIRECTORY]: { kind: "directory" },
      [DATABASE]: { kind: "link", linkTarget: { kind: "file" } },
    });
    vi.mocked(inspectPagesDatabase).mockResolvedValue({
      kind: "pages",
      hasActiveAdministrator: false,
    });

    await expect(checkDatabaseLocation(DATABASE)).resolves.toMatchObject({
      status: STATUS.EXISTING,
    });
  });
});
