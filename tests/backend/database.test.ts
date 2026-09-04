import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@duckdb/node-api", () => ({
  DuckDBInstance: {
    create: vi.fn(),
  },
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();

  return {
    ...actual,
    mkdir: vi.fn(),
    readFile: vi.fn(),
    readdir: vi.fn(),
  };
});

import { mkdir, readFile, readdir } from "node:fs/promises";

import { DuckDBInstance } from "@duckdb/node-api";

import { Database } from "@/backend/database/Database";

const mockedCreate = vi.mocked(DuckDBInstance.create);
const mockedMkdir = vi.mocked(mkdir);
const mockedReadFile = vi.mocked(readFile);
const mockedReaddir = vi.mocked(readdir);

interface MockConnection {
  closeSync: ReturnType<typeof vi.fn>;
  run: ReturnType<typeof vi.fn>;
  runAndReadAll: ReturnType<typeof vi.fn>;
}

interface MockInstance {
  closeSync: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
}

function createConnection(): MockConnection {
  return {
    closeSync: vi.fn(),
    run: vi.fn().mockResolvedValue(undefined),
    runAndReadAll: vi.fn(),
  };
}

function createInstance(connection: MockConnection): MockInstance {
  return {
    closeSync: vi.fn(),
    connect: vi.fn().mockResolvedValue(connection),
  };
}

function createReader(rows: unknown[][]): { getRows: () => unknown[][] } {
  return {
    getRows: () => rows,
  };
}

function createDirent(name: string, isFile: boolean): never {
  return {
    isFile: () => isFile,
    name,
  } as unknown as never;
}

describe("Database", () => {
  let connection: MockConnection;
  let instance: MockInstance;

  beforeEach(() => {
    connection = createConnection();
    instance = createInstance(connection);
    mockedCreate.mockResolvedValue(
      instance as unknown as Awaited<ReturnType<typeof mockedCreate>>,
    );
    mockedMkdir.mockResolvedValue(undefined);
    mockedReaddir.mockResolvedValue([]);
    mockedReadFile.mockResolvedValue("");
    connection.runAndReadAll.mockResolvedValue(createReader([]));
  });

  it("creates parent directories before opening the database", async () => {
    const database = await Database.create("/data/pages/pages.duckdb");

    expect(mockedMkdir).toHaveBeenCalledWith("/data/pages", {
      recursive: true,
    });
    expect(mockedCreate).toHaveBeenCalledWith("/data/pages/pages.duckdb");
    expect(instance.connect).toHaveBeenCalledTimes(1);

    database.close();
  });

  it("propagates directory creation failures", async () => {
    mockedMkdir.mockRejectedValueOnce(new Error("Permission denied"));

    await expect(Database.create("/restricted/pages.duckdb")).rejects.toThrow(
      "Permission denied",
    );
  });

  it("releases the connection and instance when closing", async () => {
    const database = await Database.create("/data/pages.duckdb");

    database.close();

    expect(connection.closeSync).toHaveBeenCalledTimes(1);
    expect(instance.closeSync).toHaveBeenCalledTimes(1);
  });

  it("executes statements with bound parameters", async () => {
    const database = await Database.create("/data/pages.duckdb");

    await database.execute("DELETE FROM sessions WHERE id = $id", {
      id: "session-1",
    });

    expect(connection.run).toHaveBeenCalledWith(
      "DELETE FROM sessions WHERE id = $id",
      { id: "session-1" },
    );

    database.close();
  });

  it("executes statements without parameters using an empty binding", async () => {
    const database = await Database.create("/data/pages.duckdb");

    await database.execute("DELETE FROM sessions");

    expect(connection.run).toHaveBeenCalledWith("DELETE FROM sessions", {});

    database.close();
  });

  it("returns rows from queries with bound parameters", async () => {
    const database = await Database.create("/data/pages.duckdb");
    connection.runAndReadAll.mockResolvedValue(createReader([["user-1"]]));

    const rows = await database.query("SELECT id FROM users WHERE id = $id", {
      id: "user-1",
    });

    expect(rows).toEqual([["user-1"]]);
    expect(connection.runAndReadAll).toHaveBeenCalledWith(
      "SELECT id FROM users WHERE id = $id",
      { id: "user-1" },
    );

    database.close();
  });

  it("runs parameterless queries with an empty binding", async () => {
    const database = await Database.create("/data/pages.duckdb");
    connection.runAndReadAll.mockResolvedValue(createReader([]));

    await database.query("SELECT COUNT(*) FROM users");

    expect(connection.runAndReadAll).toHaveBeenCalledWith(
      "SELECT COUNT(*) FROM users",
      {},
    );

    database.close();
  });

  it("applies pending migrations in lexical order", async () => {
    const database = await Database.create("/data/pages.duckdb");
    connection.runAndReadAll.mockResolvedValue(createReader([]));
    mockedReaddir.mockResolvedValue([
      createDirent("002_second.sql", true),
      createDirent("001_first.sql", true),
      createDirent("notes.txt", false),
      createDirent("README.md", true),
    ]);
    mockedReadFile.mockImplementation(
      async (file: unknown) => `sql:${String(file)}`,
    );

    await database.migrate("/migrations");

    const readNames = mockedReadFile.mock.calls.map((call) => String(call[0]));
    expect(readNames[0]).toContain("001_first.sql");
    expect(readNames[1]).toContain("002_second.sql");
    expect(connection.run).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO schema_migrations"),
      { name: "001_first.sql" },
    );
    expect(connection.run).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO schema_migrations"),
      { name: "002_second.sql" },
    );

    database.close();
  });

  it("skips migrations that were already applied", async () => {
    const database = await Database.create("/data/pages.duckdb");
    connection.runAndReadAll.mockResolvedValue(
      createReader([["001_first.sql"]]),
    );
    mockedReaddir.mockResolvedValue([
      createDirent("001_first.sql", true),
      createDirent("002_second.sql", true),
    ]);

    await database.migrate("/migrations");

    expect(mockedReadFile).toHaveBeenCalledTimes(1);
    expect(String(mockedReadFile.mock.calls[0]?.[0])).toContain(
      "002_second.sql",
    );

    database.close();
  });

  it("throws when a migration name has an unexpected type", async () => {
    const database = await Database.create("/data/pages.duckdb");
    connection.runAndReadAll.mockResolvedValue(createReader([[42]]));

    await expect(database.migrate("/migrations")).rejects.toThrow(
      "Database returned an invalid migration name.",
    );

    database.close();
  });

  it("rolls back and reports a failing migration", async () => {
    const database = await Database.create("/data/pages.duckdb");
    connection.runAndReadAll.mockResolvedValue(createReader([]));
    mockedReaddir.mockResolvedValue([createDirent("001_broken.sql", true)]);
    connection.run.mockImplementation(async (statement: unknown) => {
      if (typeof statement === "string" && statement.includes("BROKEN")) {
        throw new Error("Syntax error");
      }
    });
    mockedReadFile.mockResolvedValue("BROKEN SQL");

    await expect(database.migrate("/migrations")).rejects.toThrow(
      'Failed to apply database migration "001_broken.sql".',
    );
    expect(connection.run).toHaveBeenCalledWith("ROLLBACK;");

    database.close();
  });
});
