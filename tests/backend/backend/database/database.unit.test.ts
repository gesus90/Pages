import { mkdir } from "node:fs/promises";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  Database,
  IN_MEMORY_DATABASE_PATH,
  isUniqueViolationOn,
} from "@/backend/database/Database";
import { withReadScope } from "@/backend/database/ReadScope";
import {
  MigrationChecksumError,
  UnknownMigrationError,
  createMigrationChecksum,
} from "@/backend/database/Migration";

import type { Migration } from "@/backend/database/Migration";

interface EngineState {
  /** Every statement either connection received, in call order. */
  statements: string[];
  /** The bindings that came with `statements`, index by index. */
  bindings: unknown[];
  /** Rows `schema_migrations` answers with: name and checksum. */
  appliedRows: string[][];
  /** Rows every other query answers with. */
  resultRows: unknown[][];
  /** A statement containing this text fails. */
  failingFragment: string | null;
  /** Errors the next opens fail with, one per open. */
  openFailures: Error[];
  /** Paths the engine opened, in call order. */
  openedPaths: string[];
  /** Handles that were released, in call order. */
  released: string[];
}

const engine = vi.hoisted((): EngineState => ({
  appliedRows: [],
  bindings: [],
  failingFragment: null,
  openedPaths: [],
  openFailures: [],
  released: [],
  resultRows: [],
  statements: [],
}));

vi.mock("node:fs/promises", () => ({ mkdir: vi.fn() }));
vi.mock("@duckdb/node-api", () => {
  class DuckDBBlobValue {
    public readonly bytes: Uint8Array;

    public constructor(bytes: Uint8Array) {
      this.bytes = bytes;
    }
  }

  function record(statement: string, bindings: unknown): void {
    engine.statements.push(statement);
    engine.bindings.push(bindings);

    if (
      engine.failingFragment !== null &&
      statement.includes(engine.failingFragment)
    ) {
      throw new Error("statement failed");
    }
  }

  function createConnection(): object {
    return {
      closeSync: (): void => {
        engine.released.push("connection");
      },
      run: async (statement: string, bindings?: unknown): Promise<void> => {
        record(statement, bindings);
      },
      runAndReadAll: async (
        statement: string,
        bindings?: unknown,
      ): Promise<{ getRows: () => unknown[][] }> => {
        record(statement, bindings);

        return {
          getRows: () =>
            statement.includes("FROM schema_migrations")
              ? engine.appliedRows
              : engine.resultRows,
        };
      },
    };
  }

  return {
    DuckDBBlobValue,
    DuckDBInstance: {
      create: async (databasePath: string): Promise<object> => {
        engine.openedPaths.push(databasePath);

        const failure = engine.openFailures.shift();

        if (failure) {
          throw failure;
        }

        return {
          closeSync: (): void => {
            engine.released.push("instance");
          },
          connect: async (): Promise<object> => createConnection(),
        };
      },
    },
  };
});

const BASELINE: Migration = {
  name: "001_baseline.sql",
  sql: "CREATE TABLE a;",
};
const NEXT: Migration = { name: "002_next.sql", sql: "ALTER TABLE a;" };
const WAL_FAILURE = new Error(
  "IO Error: Failure while replaying WAL file of the database",
);

beforeEach(() => {
  engine.statements = [];
  engine.bindings = [];
  engine.appliedRows = [];
  engine.resultRows = [];
  engine.failingFragment = null;
  engine.openFailures = [];
  engine.openedPaths = [];
  engine.released = [];
});

/** Names what a statement did, so call order reads like a story. */
function labelOf(statement: string): string {
  const text = statement.trim();

  if (text.startsWith("BEGIN")) return "begin";
  if (text.startsWith("COMMIT")) return "commit";
  if (text.startsWith("ROLLBACK")) return "rollback";
  if (text.startsWith("CHECKPOINT")) return "checkpoint";
  if (text.includes("CREATE TABLE IF NOT EXISTS schema_migrations")) {
    return "create-migration-table";
  }
  if (text.includes("FROM schema_migrations")) return "read-applied";
  if (text.includes("INSERT INTO schema_migrations")) return "record";

  return text;
}

/** The statements after the connection setup. */
function trace(): string[] {
  return engine.statements.slice(1).map(labelOf);
}

it("opens an in-memory database without creating a directory", async () => {
  await Database.create(IN_MEMORY_DATABASE_PATH);

  expect(mkdir).not.toHaveBeenCalled();
  expect(engine.openedPaths).toEqual([IN_MEMORY_DATABASE_PATH]);
});

it("creates the directory of a database file and installs the session setup", async () => {
  await Database.create("/srv/pages/data/pages.duckdb");

  expect(mkdir).toHaveBeenCalledWith("/srv/pages/data", { recursive: true });
  expect(engine.statements[0]).toContain("default_null_order");
  expect(engine.statements[0]).toContain("MACRO utc_after(time_shift)");
  expect(engine.statements[0]).toContain("MACRO utc_now()");
});

it("applies unseen migrations in name order, one transaction each, then checkpoints", async () => {
  const database = await Database.create(IN_MEMORY_DATABASE_PATH);

  await database.migrate([NEXT, BASELINE]);

  expect(trace()).toEqual([
    "create-migration-table",
    "read-applied",
    "begin",
    BASELINE.sql,
    "record",
    "commit",
    "begin",
    NEXT.sql,
    "record",
    "commit",
    "checkpoint",
  ]);
  expect(engine.bindings[engine.statements.indexOf(BASELINE.sql) + 1]).toEqual({
    checksum: createMigrationChecksum(BASELINE.sql),
    name: BASELINE.name,
  });
});

it("applies only what the database has not seen and skips the checkpoint when nothing ran", async () => {
  engine.appliedRows = [
    [BASELINE.name, createMigrationChecksum(BASELINE.sql)],
    [NEXT.name, createMigrationChecksum(NEXT.sql)],
  ];
  const database = await Database.create(IN_MEMORY_DATABASE_PATH);

  await database.migrate([BASELINE, NEXT]);

  expect(trace()).toEqual(["create-migration-table", "read-applied"]);
});

it("runs a newly added migration on a database that has the earlier ones", async () => {
  engine.appliedRows = [[BASELINE.name, createMigrationChecksum(BASELINE.sql)]];
  const database = await Database.create(IN_MEMORY_DATABASE_PATH);

  await database.migrate([BASELINE, NEXT]);

  expect(trace()).toEqual([
    "create-migration-table",
    "read-applied",
    "begin",
    NEXT.sql,
    "record",
    "commit",
    "checkpoint",
  ]);
});

it("refuses an applied migration whose content changed", async () => {
  engine.appliedRows = [[BASELINE.name, createMigrationChecksum("OTHER;")]];
  const database = await Database.create(IN_MEMORY_DATABASE_PATH);

  await expect(database.migrate([BASELINE])).rejects.toBeInstanceOf(
    MigrationChecksumError,
  );
  expect(trace()).not.toContain("begin");
});

it("refuses a database that is ahead of the code before it runs anything", async () => {
  engine.appliedRows = [
    ["999_from_the_future.sql", createMigrationChecksum("X;")],
  ];
  const database = await Database.create(IN_MEMORY_DATABASE_PATH);

  await expect(database.migrate([BASELINE])).rejects.toBeInstanceOf(
    UnknownMigrationError,
  );
  expect(trace()).not.toContain("begin");
});

it("rolls a failing migration back and names it", async () => {
  engine.failingFragment = "BROKEN";
  const database = await Database.create(IN_MEMORY_DATABASE_PATH);
  const broken: Migration = { name: "002_broken.sql", sql: "BROKEN;" };

  const failure = await database
    .migrate([BASELINE, broken])
    .catch((error: unknown) => error);

  expect(failure).toHaveProperty(
    "message",
    'Failed to apply database migration "002_broken.sql".',
  );
  expect(failure).toHaveProperty("cause.message", "statement failed");
  expect(trace()).toContain("rollback");
  expect(trace()).not.toContain("checkpoint");
});

it("replays a write-ahead log through an attached database and opens again", async () => {
  const warn = vi.spyOn(console, "warn").mockReturnValue(undefined);

  engine.openFailures = [WAL_FAILURE];

  await Database.create("/srv/o'neil/pages.duckdb");

  expect(engine.openedPaths).toEqual([
    "/srv/o'neil/pages.duckdb",
    IN_MEMORY_DATABASE_PATH,
    "/srv/o'neil/pages.duckdb",
  ]);
  expect(engine.statements[0]).toBe(
    "ATTACH '/srv/o''neil/pages.duckdb' AS recovered; CHECKPOINT recovered; DETACH recovered;",
  );
  expect(warn).toHaveBeenCalledOnce();
});

it("rethrows every other failure to open the file", async () => {
  const failure = new Error("Could not set lock on file");

  engine.openFailures = [failure];

  await expect(Database.create("/srv/pages/pages.duckdb")).rejects.toBe(
    failure,
  );
  expect(engine.openedPaths).toEqual(["/srv/pages/pages.duckdb"]);
});

it("binds booleans as integers, buffers as blobs and nothing without parameters", async () => {
  const database = await Database.create(IN_MEMORY_DATABASE_PATH);
  const blob = Buffer.from([1, 2, 3]);

  await database.execute("INSERT INTO t VALUES ($on, $off, $file, $text);", {
    file: blob,
    off: false,
    on: true,
    text: "x",
  });
  await database.execute("DELETE FROM t;");

  const [bound] = engine.bindings.slice(-2);

  expect(bound).toMatchObject({
    file: { bytes: blob },
    off: 0,
    on: 1,
    text: "x",
  });
  expect(engine.bindings.at(-1)).toBeUndefined();
});

it("reads 64-bit integers as numbers while they are safe and keeps larger ones exact", async () => {
  const database = await Database.create(IN_MEMORY_DATABASE_PATH);
  const unsafe = 2n ** 60n;

  engine.resultRows = [[42n, unsafe, 7, "text", null, true, false]];

  await expect(database.query("SELECT 1;")).resolves.toEqual([
    [42, unsafe, 7, "text", null, 1, 0],
  ]);
});

it("returns blob columns as buffers", async () => {
  const { DuckDBBlobValue } = await import("@duckdb/node-api");
  const database = await Database.create(IN_MEMORY_DATABASE_PATH);

  engine.resultRows = [[new DuckDBBlobValue(new Uint8Array([9, 8]))]];

  const [[column]] = await database.query("SELECT 1;");

  expect(Buffer.isBuffer(column)).toBe(true);
  expect(column).toEqual(Buffer.from([9, 8]));
});

it("rejects a column type the repositories cannot read", async () => {
  const database = await Database.create(IN_MEMORY_DATABASE_PATH);

  engine.resultRows = [[{ unsupported: true }]];

  await expect(database.query("SELECT 1;")).rejects.toThrow("unsupported type");
});

it("commits a transaction and returns what its work returns", async () => {
  const database = await Database.create(IN_MEMORY_DATABASE_PATH);

  const result = await database.transaction(async (transaction) => {
    await transaction.execute("UPDATE t SET a = 1;");

    return "done";
  });

  expect(result).toBe("done");
  expect(trace()).toEqual(["begin", "UPDATE t SET a = 1;", "commit"]);
});

it("rolls a transaction back and rethrows when its work fails", async () => {
  const database = await Database.create(IN_MEMORY_DATABASE_PATH);
  const failure = new Error("work failed");

  await expect(
    database.transaction(async (transaction) => {
      await transaction.execute("UPDATE t SET a = 1;");

      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(trace()).toEqual(["begin", "UPDATE t SET a = 1;", "rollback"]);
});

it("releases the connection and the instance when it closes", async () => {
  const database = await Database.create(IN_MEMORY_DATABASE_PATH);

  await database.close();

  expect(trace()).toEqual(["checkpoint"]);
  expect(engine.released).toEqual(["connection", "instance"]);
});

it("computes the same migration checksum for both line-ending styles", () => {
  expect(createMigrationChecksum("A;\r\nB;\r\n")).toBe(
    createMigrationChecksum("A;\nB;\n"),
  );
  expect(createMigrationChecksum("A;")).not.toBe(createMigrationChecksum("B;"));
});

it("reads rows inside a transaction", async () => {
  const database = await Database.create(IN_MEMORY_DATABASE_PATH);

  engine.resultRows = [["a", 1]];

  const rows = await database.transaction(async (transaction) =>
    transaction.query("SELECT 1;"),
  );

  expect(rows).toEqual([["a", 1]]);
});

it("recognizes a duplicate key of the named column only", () => {
  const duplicate = new Error(
    'Constraint Error: Duplicate key "username: alice" violates unique constraint.',
  );

  expect(isUniqueViolationOn(duplicate, "username")).toBe(true);
  expect(isUniqueViolationOn(duplicate, "email")).toBe(false);
  expect(isUniqueViolationOn("Duplicate key", "username")).toBe(false);
});

describe("reads that repeat inside one unit of work", () => {
  const READ = "SELECT id FROM projects WHERE id = $id;";

  it("asks the database once for the same read and hands out equal rows", async () => {
    const database = await Database.create(IN_MEMORY_DATABASE_PATH);
    engine.resultRows = [["a", 1]];

    const answers = await withReadScope(async () => [
      await database.query(READ, { id: "p1" }),
      await database.query(READ, { id: "p1" }),
    ]);

    expect(trace()).toEqual([READ]);
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[1]).not.toBe(answers[0]);
  });

  it("asks every time outside a unit of work", async () => {
    const database = await Database.create(IN_MEMORY_DATABASE_PATH);

    await database.query(READ, { id: "p1" });
    await database.query(READ, { id: "p1" });

    expect(trace()).toEqual([READ, READ]);
  });

  it("asks again for other values and in another unit of work", async () => {
    const database = await Database.create(IN_MEMORY_DATABASE_PATH);

    await withReadScope(async () => {
      await database.query(READ, { id: "p1" });
      await database.query(READ, { id: "p2" });
    });
    await withReadScope(async () => database.query(READ, { id: "p1" }));

    expect(trace()).toEqual([READ, READ, READ]);
  });

  it("asks again after any write, whoever made it", async () => {
    const database = await Database.create(IN_MEMORY_DATABASE_PATH);

    await withReadScope(async () => {
      await database.query(READ, { id: "p1" });
      await database.execute("UPDATE projects SET name = 'x';");
      await database.query(READ, { id: "p1" });
      await database.query("INSERT INTO t VALUES (1) RETURNING id;");
      await database.query(READ, { id: "p1" });
    });

    expect(trace()).toEqual([
      READ,
      "UPDATE projects SET name = 'x';",
      READ,
      "INSERT INTO t VALUES (1) RETURNING id;",
      READ,
    ]);
  });

  it("sees the write of another unit of work that ran in between", async () => {
    const database = await Database.create(IN_MEMORY_DATABASE_PATH);

    await withReadScope(async () => {
      await database.query(READ, { id: "p1" });
      await Promise.resolve(
        withReadScope(async () =>
          database.execute("UPDATE projects SET name = 'x';"),
        ),
      );
      await database.query(READ, { id: "p1" });
    });

    expect(trace()).toEqual([READ, "UPDATE projects SET name = 'x';", READ]);
  });

  it("never repeats a read whose answer changes by itself or that takes a number", async () => {
    const database = await Database.create(IN_MEMORY_DATABASE_PATH);

    await withReadScope(async () => {
      await database.query("SELECT utc_now();");
      await database.query("SELECT utc_now();");
      await database.query("SELECT nextval('numbers');");
      await database.query("SELECT nextval('numbers');");
    });

    expect(trace()).toHaveLength(4);
  });
});

describe("transactions inside one unit of work", () => {
  const READ = "SELECT id FROM projects WHERE id = $id;";

  it("keeps a transaction that only reads off the database when the scope knows the answer", async () => {
    const database = await Database.create(IN_MEMORY_DATABASE_PATH);
    engine.resultRows = [["a", 1]];

    const rows = await withReadScope(async () => {
      await database.query(READ, { id: "p1" });
      return database.transaction(async (transaction) =>
        transaction.query(READ, { id: "p1" }),
      );
    });

    expect(rows).toEqual([["a", 1]]);
    expect(trace()).toEqual([READ]);
  });

  it("opens the transaction for the first read the scope cannot answer and at its first write", async () => {
    const database = await Database.create(IN_MEMORY_DATABASE_PATH);

    await withReadScope(async () => {
      await database.query(READ, { id: "p1" });
      await database.transaction(async (transaction) => {
        await transaction.query(READ, { id: "p1" });
        await transaction.query(READ, { id: "p2" });
        await transaction.execute("UPDATE projects SET name = 'x';");
        await transaction.query(READ, { id: "p1" });
      });
    });

    expect(trace()).toEqual([
      READ,
      "begin",
      READ,
      "UPDATE projects SET name = 'x';",
      READ,
      "commit",
    ]);
  });

  it("asks again after a transaction that wrote, even one that was rolled back", async () => {
    const database = await Database.create(IN_MEMORY_DATABASE_PATH);

    await withReadScope(async () => {
      await database.query(READ, { id: "p1" });
      await database
        .transaction(async (transaction) => {
          await transaction.execute("UPDATE projects SET name = 'x';");
          throw new Error("refused");
        })
        .catch(() => undefined);
      await database.query(READ, { id: "p1" });
    });

    expect(trace()).toEqual([
      READ,
      "begin",
      "UPDATE projects SET name = 'x';",
      "rollback",
      READ,
    ]);
  });

  it("does not forget the answers when a transaction only read", async () => {
    const database = await Database.create(IN_MEMORY_DATABASE_PATH);

    await withReadScope(async () => {
      await database.query(READ, { id: "p1" });
      await database.transaction(async (transaction) =>
        transaction.query(READ, { id: "p2" }),
      );
      await database.query(READ, { id: "p1" });
    });

    expect(trace()).toEqual([READ, "begin", READ, "commit"]);
  });
});
