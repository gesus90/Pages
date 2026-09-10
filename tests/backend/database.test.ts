import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("better-sqlite3", () => ({
  default: vi.fn(),
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

import SqliteDatabase from "better-sqlite3";

import { Database } from "@/backend/database/Database";

const MockedSqliteDatabase = vi.mocked(SqliteDatabase);
const mockedMkdir = vi.mocked(mkdir);
const mockedReadFile = vi.mocked(readFile);
const mockedReaddir = vi.mocked(readdir);

interface MockStatement {
  all: ReturnType<typeof vi.fn>;
  raw: ReturnType<typeof vi.fn>;
  run: ReturnType<typeof vi.fn>;
}

interface MockConnection {
  close: ReturnType<typeof vi.fn>;
  exec: ReturnType<typeof vi.fn>;
  pragma: ReturnType<typeof vi.fn>;
  prepare: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
}

function createStatement(): MockStatement {
  const statement: MockStatement = {
    all: vi.fn().mockReturnValue([]),
    raw: vi.fn(),
    run: vi.fn(),
  };
  statement.raw.mockReturnValue(statement);

  return statement;
}

function createConnection(): MockConnection {
  const connection: MockConnection = {
    close: vi.fn(),
    exec: vi.fn(),
    pragma: vi.fn(),
    prepare: vi.fn(),
    transaction: vi.fn((callback: () => void) => callback),
  };
  connection.prepare.mockImplementation(() => createStatement());

  return connection;
}

function createDirent(name: string, isFile: boolean): never {
  return {
    isFile: () => isFile,
    name,
  } as unknown as never;
}

describe("Database", () => {
  let connection: MockConnection;

  beforeEach(() => {
    connection = createConnection();
    MockedSqliteDatabase.mockImplementation(function () {
      return connection as unknown as InstanceType<typeof SqliteDatabase>;
    });
    mockedMkdir.mockResolvedValue(undefined);
    mockedReaddir.mockResolvedValue([]);
    mockedReadFile.mockResolvedValue("");
  });

  it("creates parent directories before opening the database", async () => {
    const database = await Database.create("/data/pages/pages.db");

    expect(mockedMkdir).toHaveBeenCalledWith("/data/pages", {
      recursive: true,
    });
    expect(MockedSqliteDatabase).toHaveBeenCalledWith("/data/pages/pages.db");

    database.close();
  });

  it("enables WAL mode and foreign keys on new connections", async () => {
    const database = await Database.create("/data/pages.db");

    expect(connection.pragma).toHaveBeenCalledWith("journal_mode = WAL");
    expect(connection.pragma).toHaveBeenCalledWith("foreign_keys = ON");

    database.close();
  });

  it("propagates directory creation failures", async () => {
    mockedMkdir.mockRejectedValueOnce(new Error("Permission denied"));

    await expect(Database.create("/restricted/pages.db")).rejects.toThrow(
      "Permission denied",
    );
  });

  it("releases the connection when closing", async () => {
    const database = await Database.create("/data/pages.db");

    database.close();

    expect(connection.close).toHaveBeenCalledTimes(1);
  });

  it("executes statements with bound parameters", async () => {
    const database = await Database.create("/data/pages.db");

    await database.execute("DELETE FROM sessions WHERE id = $id", {
      id: "session-1",
    });

    expect(connection.prepare).toHaveBeenCalledWith(
      "DELETE FROM sessions WHERE id = $id",
    );

    const statement = connection.prepare.mock.results[0]
      ?.value as MockStatement;

    expect(statement.run).toHaveBeenCalledWith({ id: "session-1" });

    database.close();
  });

  it("executes statements without parameters using an empty binding", async () => {
    const database = await Database.create("/data/pages.db");

    await database.execute("DELETE FROM sessions");

    const statement = connection.prepare.mock.results[0]
      ?.value as MockStatement;

    expect(statement.run).toHaveBeenCalledWith({});

    database.close();
  });

  it("converts boolean bindings to SQLite integers", async () => {
    const database = await Database.create("/data/pages.db");

    await database.execute("UPDATE users SET is_active = $is_active", {
      is_active: true,
    });

    const enabled = connection.prepare.mock.results[0]?.value as MockStatement;

    expect(enabled.run).toHaveBeenCalledWith({ is_active: 1 });

    await database.execute("UPDATE users SET is_active = $is_active", {
      is_active: false,
    });

    const disabled = connection.prepare.mock.results[1]?.value as MockStatement;

    expect(disabled.run).toHaveBeenCalledWith({ is_active: 0 });

    database.close();
  });

  it("propagates execution failures", async () => {
    const database = await Database.create("/data/pages.db");
    connection.prepare.mockImplementation(() => {
      throw new Error("Bad SQL");
    });

    await expect(database.execute("BROKEN SQL")).rejects.toThrow("Bad SQL");

    database.close();
  });

  it("returns rows from queries with bound parameters", async () => {
    const database = await Database.create("/data/pages.db");
    const statement = createStatement();
    statement.all.mockReturnValue([["user-1"]]);
    connection.prepare.mockReturnValue(statement);

    const rows = await database.query("SELECT id FROM users WHERE id = $id", {
      id: "user-1",
    });

    expect(rows).toEqual([["user-1"]]);
    expect(statement.raw).toHaveBeenCalledTimes(1);
    expect(statement.all).toHaveBeenCalledWith({ id: "user-1" });

    database.close();
  });

  it("runs parameterless queries with an empty binding", async () => {
    const database = await Database.create("/data/pages.db");
    const statement = createStatement();
    connection.prepare.mockReturnValue(statement);

    await database.query("SELECT COUNT(*) FROM users");

    expect(statement.all).toHaveBeenCalledWith({});

    database.close();
  });

  it("propagates query failures", async () => {
    const database = await Database.create("/data/pages.db");
    connection.prepare.mockImplementation(() => {
      throw new Error("Bad query");
    });

    await expect(database.query("BROKEN QUERY")).rejects.toThrow("Bad query");

    database.close();
  });

  it("applies pending migrations in lexical order", async () => {
    const database = await Database.create("/data/pages.db");
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
    expect(connection.transaction).toHaveBeenCalledTimes(2);
    expect(connection.exec).toHaveBeenCalledWith(
      expect.stringContaining("CREATE TABLE IF NOT EXISTS schema_migrations"),
    );

    database.close();
  });

  it("records applied migrations in the schema table", async () => {
    const database = await Database.create("/data/pages.db");
    mockedReaddir.mockResolvedValue([createDirent("001_first.sql", true)]);
    mockedReadFile.mockResolvedValue("CREATE TABLE example (id TEXT);");
    const inserts: unknown[] = [];
    connection.prepare.mockImplementation((statement: unknown) => {
      const created = createStatement();
      created.run.mockImplementation((bindings: unknown) => {
        if (
          typeof statement === "string" &&
          statement.includes("INSERT INTO schema_migrations")
        ) {
          inserts.push(bindings);
        }

        return undefined;
      });

      return created;
    });

    await database.migrate("/migrations");

    expect(inserts).toEqual([{ name: "001_first.sql" }]);

    database.close();
  });

  it("skips migrations that were already applied", async () => {
    const database = await Database.create("/data/pages.db");
    const applied = createStatement();
    applied.all.mockReturnValue([["001_first.sql"]]);
    const fresh = createStatement();
    connection.prepare.mockImplementation((statement: unknown) =>
      typeof statement === "string" &&
      statement.includes("FROM schema_migrations")
        ? applied
        : fresh,
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

  it("applies no migration when the directory holds no SQL files", async () => {
    const database = await Database.create("/data/pages.db");
    mockedReaddir.mockResolvedValue([
      createDirent("notes.txt", true),
      createDirent("archive", false),
    ]);

    await database.migrate("/migrations");

    expect(mockedReadFile).not.toHaveBeenCalled();
    expect(connection.transaction).not.toHaveBeenCalled();

    database.close();
  });

  it("throws when a migration name has an unexpected type", async () => {
    const database = await Database.create("/data/pages.db");
    const applied = createStatement();
    applied.all.mockReturnValue([[42]]);
    connection.prepare.mockReturnValue(applied);

    await expect(database.migrate("/migrations")).rejects.toThrow(
      "Database returned an invalid migration name.",
    );

    database.close();
  });

  it("reports a failing migration with its file name", async () => {
    const database = await Database.create("/data/pages.db");
    mockedReaddir.mockResolvedValue([createDirent("001_broken.sql", true)]);
    mockedReadFile.mockResolvedValue("BROKEN SQL");
    connection.exec.mockImplementation((statement: unknown) => {
      if (typeof statement === "string" && statement.includes("BROKEN")) {
        throw new Error("Syntax error");
      }
    });

    await expect(database.migrate("/migrations")).rejects.toThrow(
      'Failed to apply database migration "001_broken.sql".',
    );

    database.close();
  });
});
