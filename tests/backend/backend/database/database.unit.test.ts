import { beforeEach, describe, expect, it, vi } from "vitest";

import { Database, isUniqueViolationOn } from "@/backend/database/Database";
import { withReadScope } from "@/backend/database/ReadScope";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import {
  MigrationChecksumError,
  UnknownMigrationError,
  createMigrationChecksum,
} from "@/backend/database/Migration";

import type { Migration } from "@/backend/database/Migration";
import type * as LoggerModule from "@/backend/logging/Logger";

interface EngineState {
  /** Every statement the worker received, in call order. */
  statements: string[];
  /** The bindings that came with `statements`, index by index. */
  bindings: unknown[];
  /** Rows `schema_migrations` answers with: name and checksum. */
  appliedRows: string[][];
  /** Rows every other query answers with. */
  resultRows: unknown[][];
  /** A statement containing this text fails. */
  failingFragment: string | null;
  /** Errors the next worker starts fail with, one per start. */
  openFailures: Error[];
  /** Paths a worker was started for, in call order. */
  openedPaths: string[];
  /** DuckDB memory limits a worker was started with, in call order. */
  openedMemoryLimits: string[];
  /** Workers that were closed, in call order. */
  released: string[];
  /** What the executor asked the worker client at its close, in call order. */
  closeSteps: string[];
  /** The status read at the close fails with this. */
  statusFailure: Error | null;
  /** The close of the worker fails with this, after it was attempted. */
  closeFailure: Error | null;
}

const engine = vi.hoisted((): EngineState => ({
  appliedRows: [],
  bindings: [],
  closeFailure: null,
  closeSteps: [],
  failingFragment: null,
  openedMemoryLimits: [],
  openedPaths: [],
  openFailures: [],
  released: [],
  resultRows: [],
  statements: [],
  statusFailure: null,
}));

vi.mock("@/backend/logging/Logger", async (importOriginal) => ({
  ...(await importOriginal<typeof LoggerModule>()),
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));
// The existing database boundary is now the PostgreSQL pool.
vi.mock("@/backend/database/postgres/PostgresExecutor", () => {
  class FakePostgresExecutor {
    /** Opens the mock pool. */
    public static async start(url: string): Promise<FakePostgresExecutor> {
      engine.openedPaths.push(url);
      const failure = engine.openFailures.shift();
      if (failure) throw failure;
      return new FakePostgresExecutor();
    }
    /** Runs writer work. */
    public async write<T>(
      work: (writer: {
        run: (statement: string, parameters: unknown) => Promise<unknown[][]>;
      }) => Promise<T>,
    ): Promise<T> {
      return work({
        run: (statement, parameters) => this.run(statement, parameters),
      });
    }
    /** Runs a read. */
    public async read(
      statement: string,
      parameters: unknown,
    ): Promise<unknown[][]> {
      return this.run(statement, parameters);
    }
    /** Runs reader work. */
    public async readSession<T>(
      work: (reader: {
        query: (statement: string, parameters: unknown) => Promise<unknown[][]>;
      }) => Promise<T>,
    ): Promise<T> {
      return work({
        query: (statement, parameters) => this.run(statement, parameters),
      });
    }
    /** Returns the mock pool status. */
    public status(): object {
      return {
        worker: {
          state: "ready",
          generation: 1,
          restarts: 0,
          pendingStatements: 0,
          pid: null,
        },
        writer: {},
        readers: {},
        readerConnections: 9,
        reroutedReads: 0,
      };
    }
    /** Closes the mock pool. */
    public async close(): Promise<void> {
      engine.closeSteps.push("close");
      engine.released.push("pool");
      if (engine.closeFailure) throw engine.closeFailure;
    }
    private async run(
      statement: string,
      parameters: unknown,
    ): Promise<unknown[][]> {
      if (statement.includes("pg_encoding_to_char"))
        return [["UTF8", "c", "C.UTF-8", "C.UTF-8"]];
      engine.statements.push(statement);
      engine.bindings.push(parameters);
      if (
        engine.failingFragment !== null &&
        statement.includes(engine.failingFragment)
      )
        throw new Error("statement failed");
      return statement.includes("FROM postgres_schema_migrations")
        ? engine.appliedRows
        : engine.resultRows;
    }
  }
  return { PostgresExecutor: FakePostgresExecutor };
});

const BASELINE: Migration = {
  name: "001_baseline.sql",
  sql: "CREATE TABLE a;",
};
const NEXT: Migration = { name: "002_next.sql", sql: "ALTER TABLE a;" };

beforeEach(() => {
  engine.statements = [];
  engine.bindings = [];
  engine.appliedRows = [];
  engine.resultRows = [];
  engine.failingFragment = null;
  engine.openFailures = [];
  engine.openedPaths = [];
  engine.openedMemoryLimits = [];
  engine.released = [];
  engine.closeSteps = [];
  engine.statusFailure = null;
  engine.closeFailure = null;
  vi.mocked(logCaughtError).mockReset();
  vi.mocked(logEvent).mockReset();
});

/** Names what a statement did, so call order reads like a story. */
function labelOf(statement: string): string {
  const text = statement.trim();

  if (text.startsWith("BEGIN")) return "begin";
  if (text.startsWith("COMMIT")) return "commit";
  if (text.startsWith("ROLLBACK")) return "rollback";
  if (text.startsWith("CHECKPOINT")) return "checkpoint";
  if (text.includes("CREATE TABLE IF NOT EXISTS postgres_schema_migrations")) {
    return "create-migration-table";
  }
  if (text.includes("FROM postgres_schema_migrations")) return "read-applied";
  if (text.includes("INSERT INTO postgres_schema_migrations")) return "record";

  return text;
}

/** The statements the server sent; the connection setup stays in the worker. */
function trace(): string[] {
  return engine.statements.map(labelOf);
}

it("applies unseen migrations in name order, one transaction each, then checkpoints", async () => {
  const database = await Database.connect("postgresql://localhost/pages");

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
  const database = await Database.connect("postgresql://localhost/pages");

  await database.migrate([BASELINE, NEXT]);

  expect(trace()).toEqual(["create-migration-table", "read-applied"]);
});

it("runs a newly added migration on a database that has the earlier ones", async () => {
  engine.appliedRows = [[BASELINE.name, createMigrationChecksum(BASELINE.sql)]];
  const database = await Database.connect("postgresql://localhost/pages");

  await database.migrate([BASELINE, NEXT]);

  expect(trace()).toEqual([
    "create-migration-table",
    "read-applied",
    "begin",
    NEXT.sql,
    "record",
    "commit",
  ]);
});

it("refuses an applied migration whose content changed", async () => {
  engine.appliedRows = [[BASELINE.name, createMigrationChecksum("OTHER;")]];
  const database = await Database.connect("postgresql://localhost/pages");

  await expect(database.migrate([BASELINE])).rejects.toBeInstanceOf(
    MigrationChecksumError,
  );
  expect(trace()).not.toContain("begin");
});

it("refuses a database that is ahead of the code before it runs anything", async () => {
  engine.appliedRows = [
    ["999_from_the_future.sql", createMigrationChecksum("X;")],
  ];
  const database = await Database.connect("postgresql://localhost/pages");

  await expect(database.migrate([BASELINE])).rejects.toBeInstanceOf(
    UnknownMigrationError,
  );
  expect(trace()).not.toContain("begin");
});

it("rolls a failing migration back and names it", async () => {
  engine.failingFragment = "BROKEN";
  const database = await Database.connect("postgresql://localhost/pages");
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

it("rethrows every other failure to open the file", async () => {
  const failure = new Error("Could not set lock on file");

  engine.openFailures = [failure];

  await expect(Database.connect("postgresql://localhost/pages")).rejects.toBe(
    failure,
  );
  expect(engine.openedPaths).toEqual(["postgresql://localhost/pages"]);
});

it("returns blob columns as buffers", async () => {
  const database = await Database.connect("postgresql://localhost/pages");

  // Blobs cross the process boundary as plain byte arrays.
  engine.resultRows = [[Buffer.from([9, 8])]];

  const [[column]] = await database.query("SELECT 1;");

  expect(Buffer.isBuffer(column)).toBe(true);
  expect(column).toEqual(Buffer.from([9, 8]));
});

it("commits a transaction and returns what its work returns", async () => {
  const database = await Database.connect("postgresql://localhost/pages");

  const effects: string[][] = [];

  const result = await database.transaction(async (transaction) => {
    await transaction.execute("UPDATE t SET a = 1;");
    transaction.onCommit?.(async () => {
      effects.push(trace());
    });
    transaction.onRollback?.(async () => {
      effects.push(["rollback effect"]);
    });

    return "done";
  });

  expect(result).toBe("done");
  expect(trace()).toEqual(["begin", "UPDATE t SET a = 1;", "commit"]);
  expect(effects).toEqual([["begin", "UPDATE t SET a = 1;", "commit"]]);
});

it("rolls a transaction back and rethrows when its work fails", async () => {
  const database = await Database.connect("postgresql://localhost/pages");
  const failure = new Error("work failed");
  const effects: string[][] = [];

  await expect(
    database.transaction(async (transaction) => {
      await transaction.execute("UPDATE t SET a = 1;");
      transaction.onCommit?.(async () => {
        effects.push(["commit effect"]);
      });
      transaction.onRollback?.(async () => {
        effects.push(["first", ...trace()]);
      });
      transaction.onRollback?.(async () => {
        effects.push(["second"]);
      });

      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(trace()).toEqual(["begin", "UPDATE t SET a = 1;", "rollback"]);
  expect(effects).toEqual([
    ["second"],
    ["first", "begin", "UPDATE t SET a = 1;", "rollback"],
  ]);
});

it("closes the PostgreSQL pool", async () => {
  const database = await Database.connect("postgresql://localhost/pages");
  await database.close();
  expect(engine.released).toEqual(["pool"]);
});

it("does not hide a failed close or claim the database closed", async () => {
  const database = await Database.connect("postgresql://localhost/pages");
  const failure = new Error("close failed");
  engine.closeFailure = failure;
  vi.mocked(logEvent).mockClear();
  await expect(database.close()).rejects.toBe(failure);
  expect(
    vi.mocked(logEvent).mock.calls.map(([event]) => event.event),
  ).not.toContain("database.closed");
});

it("computes the same migration checksum for both line-ending styles", () => {
  expect(createMigrationChecksum("A;\r\nB;\r\n")).toBe(
    createMigrationChecksum("A;\nB;\n"),
  );
  expect(createMigrationChecksum("A;")).not.toBe(createMigrationChecksum("B;"));
});

it("reads rows inside a transaction", async () => {
  const database = await Database.connect("postgresql://localhost/pages");

  engine.resultRows = [["a", 1]];

  const rows = await database.transaction(async (transaction) =>
    transaction.query("SELECT 1;"),
  );

  expect(rows).toEqual([["a", 1]]);
});

it("recognizes a duplicate key of the named column only", () => {
  const duplicate = Object.assign(new Error("duplicate"), {
    code: "23505",
    detail: "Key (username)=(alice) already exists.",
  });

  expect(isUniqueViolationOn(duplicate, "username")).toBe(true);
  expect(isUniqueViolationOn(duplicate, "email")).toBe(false);
  expect(isUniqueViolationOn("Duplicate key", "username")).toBe(false);
});

describe("reads that repeat inside one unit of work", () => {
  const READ = "SELECT id FROM projects WHERE id = $id;";

  it("asks the database once for the same read and hands out equal rows", async () => {
    const database = await Database.connect("postgresql://localhost/pages");
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
    const database = await Database.connect("postgresql://localhost/pages");

    await database.query(READ, { id: "p1" });
    await database.query(READ, { id: "p1" });

    expect(trace()).toEqual([READ, READ]);
  });

  it("asks again for other values and in another unit of work", async () => {
    const database = await Database.connect("postgresql://localhost/pages");

    await withReadScope(async () => {
      await database.query(READ, { id: "p1" });
      await database.query(READ, { id: "p2" });
    });
    await withReadScope(async () => database.query(READ, { id: "p1" }));

    expect(trace()).toEqual([READ, READ, READ]);
  });

  it("asks again after any write, whoever made it", async () => {
    const database = await Database.connect("postgresql://localhost/pages");

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
    const database = await Database.connect("postgresql://localhost/pages");

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
    const database = await Database.connect("postgresql://localhost/pages");

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

  it("reads transaction state afresh even when the request scope knows an earlier answer", async () => {
    const database = await Database.connect("postgresql://localhost/pages");
    engine.resultRows = [["a", 1]];

    const rows = await withReadScope(async () => {
      await database.query(READ, { id: "p1" });
      return database.transaction(async (transaction) =>
        transaction.query(READ, { id: "p1" }),
      );
    });

    expect(rows).toEqual([["a", 1]]);
    expect(trace()).toEqual([READ, "begin", READ, "commit"]);
  });

  it("does not reuse request-scope reads inside a write transaction", async () => {
    const database = await Database.connect("postgresql://localhost/pages");

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
      READ,
      "UPDATE projects SET name = 'x';",
      READ,
      "commit",
    ]);
  });

  it("asks again after a transaction that wrote, even one that was rolled back", async () => {
    const database = await Database.connect("postgresql://localhost/pages");

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
    const database = await Database.connect("postgresql://localhost/pages");

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
