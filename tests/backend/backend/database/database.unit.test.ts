import { mkdir } from "node:fs/promises";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  Database,
  IN_MEMORY_DATABASE_PATH,
  isUniqueViolationOn,
} from "@/backend/database/Database";
import { withReadScope } from "@/backend/database/ReadScope";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import {
  MigrationChecksumError,
  UnknownMigrationError,
  createMigrationChecksum,
} from "@/backend/database/Migration";

import type * as WorkerClientModule from "@/backend/database/executor/DatabaseWorkerClient";
import type { WorkerStatement } from "@/backend/database/executor/DatabaseWorkerClient";
import type { WorkerConfiguration } from "@/backend/database/executor/DatabaseWorkerProtocol";
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
  openedPaths: [],
  openFailures: [],
  released: [],
  resultRows: [],
  statements: [],
  statusFailure: null,
}));

vi.mock("node:fs/promises", () => ({ mkdir: vi.fn() }));
vi.mock("@/backend/logging/Logger", async (importOriginal) => ({
  ...(await importOriginal<typeof LoggerModule>()),
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));
// The worker process owns DuckDB; its client is the boundary the server sees.
vi.mock(
  "@/backend/database/executor/DatabaseWorkerClient",
  async (importOriginal) => {
    const actual = await importOriginal<typeof WorkerClientModule>();
    const timing = {
      executionMs: 0,
      waitMs: 0,
      walBytesAfter: null,
      walBytesBefore: null,
    };

    class FakeWorkerClient {
      /** Opens nothing; records the path and fails like a worker that cannot open. */
      public static async start(
        configuration: WorkerConfiguration,
      ): Promise<FakeWorkerClient> {
        engine.openedPaths.push(configuration.databasePath);

        const failure = engine.openFailures.shift();

        if (failure) {
          throw failure;
        }

        return new FakeWorkerClient();
      }

      public get currentGeneration(): number {
        return 1;
      }

      /** Records the statement and answers it from the engine state. */
      public async run(request: WorkerStatement): Promise<object> {
        engine.statements.push(request.statement);
        engine.bindings.push(request.parameters);

        if (
          engine.failingFragment !== null &&
          request.statement.includes(engine.failingFragment)
        ) {
          throw new actual.WorkerStatementError(
            { message: "statement failed", name: "Error" },
            timing,
            false,
          );
        }

        const rows = request.statement.includes("FROM schema_migrations")
          ? engine.appliedRows
          : engine.resultRows;

        return {
          roundTripMs: 0,
          rows: request.mode === "rows" ? rows : null,
          timing,
        };
      }

      /** The executor reports these counters once more before the worker closes. */
      public status(): WorkerClientModule.DatabaseWorkerStatus {
        engine.closeSteps.push("status");
        if (engine.statusFailure) throw engine.statusFailure;
        return {
          state: "ready",
          generation: 1,
          restarts: 0,
          pendingStatements: 0,
          pid: null,
        };
      }

      /** Stands in for the worker's closing checkpoint and exit. */
      public async close(): Promise<void> {
        engine.closeSteps.push("close");
        engine.released.push("worker");
        if (engine.closeFailure) throw engine.closeFailure;
      }
    }

    return { ...actual, DatabaseWorkerClient: FakeWorkerClient };
  },
);

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
  if (text.includes("CREATE TABLE IF NOT EXISTS schema_migrations")) {
    return "create-migration-table";
  }
  if (text.includes("FROM schema_migrations")) return "read-applied";
  if (text.includes("INSERT INTO schema_migrations")) return "record";

  return text;
}

/** The statements the server sent; the connection setup stays in the worker. */
function trace(): string[] {
  return engine.statements.map(labelOf);
}

it("opens an in-memory database without creating a directory", async () => {
  await Database.create(IN_MEMORY_DATABASE_PATH);

  expect(mkdir).not.toHaveBeenCalled();
  expect(engine.openedPaths).toEqual([IN_MEMORY_DATABASE_PATH]);
});

it("creates the directory of a database file before the worker opens it", async () => {
  await Database.create("/srv/pages/data/pages.duckdb");

  expect(mkdir).toHaveBeenCalledWith("/srv/pages/data", { recursive: true });
  expect(engine.openedPaths).toEqual(["/srv/pages/data/pages.duckdb"]);
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

it("rethrows every other failure to open the file", async () => {
  const failure = new Error("Could not set lock on file");

  engine.openFailures = [failure];

  await expect(Database.create("/srv/pages/pages.duckdb")).rejects.toBe(
    failure,
  );
  expect(engine.openedPaths).toEqual(["/srv/pages/pages.duckdb"]);
});

it("returns blob columns as buffers", async () => {
  const database = await Database.create(IN_MEMORY_DATABASE_PATH);

  // Blobs cross the process boundary as plain byte arrays.
  engine.resultRows = [[new Uint8Array([9, 8])]];

  const [[column]] = await database.query("SELECT 1;");

  expect(Buffer.isBuffer(column)).toBe(true);
  expect(column).toEqual(Buffer.from([9, 8]));
});

it("commits a transaction and returns what its work returns", async () => {
  const database = await Database.create(IN_MEMORY_DATABASE_PATH);

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
  const database = await Database.create(IN_MEMORY_DATABASE_PATH);
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

it("lets the worker checkpoint and release the database when it closes", async () => {
  const database = await Database.create(IN_MEMORY_DATABASE_PATH);

  await database.close();

  // The worker runs the closing CHECKPOINT on its own writer connection.
  expect(trace()).toEqual([]);
  expect(engine.released).toEqual(["worker"]);
});

/** The events the close wrote, by name. */
function loggedEvents(): string[] {
  return vi.mocked(logEvent).mock.calls.map(([event]) => event.event);
}

it("reports the last counters before the worker closes", async () => {
  const database = await Database.create(IN_MEMORY_DATABASE_PATH);
  await database.execute("UPDATE t SET a = 1;");
  vi.mocked(logEvent).mockClear();

  await database.close();

  expect(engine.closeSteps).toEqual(["status", "close"]);
  expect(loggedEvents()).toEqual([
    "database.executor.status",
    "database.closed",
  ]);
  expect(logCaughtError).not.toHaveBeenCalled();
});

it("still closes the worker when the last counters cannot be read", async () => {
  const failure = new Error("status failed");
  const database = await Database.create(IN_MEMORY_DATABASE_PATH);
  engine.statusFailure = failure;

  await expect(database.close()).resolves.toBeUndefined();

  expect(engine.closeSteps).toEqual(["status", "close"]);
  expect(engine.released).toEqual(["worker"]);
  expect(logCaughtError).toHaveBeenCalledExactlyOnceWith(
    "DatabaseExecutor",
    failure,
  );
  expect(loggedEvents()).toContain("database.closed");
});

it("does not hide a failed close or claim the database closed", async () => {
  const failure = new Error("checkpoint failed");
  const database = await Database.create(IN_MEMORY_DATABASE_PATH);
  engine.closeFailure = failure;

  await expect(database.close()).rejects.toBe(failure);

  expect(engine.closeSteps).toEqual(["status", "close"]);
  expect(logCaughtError).not.toHaveBeenCalled();
  expect(loggedEvents()).not.toContain("database.closed");
});

it("lets a failed close outrank a failed report, keeping both", async () => {
  const statusFailure = new Error("status failed");
  const closeFailure = new Error("checkpoint failed");
  const database = await Database.create(IN_MEMORY_DATABASE_PATH);
  engine.statusFailure = statusFailure;
  engine.closeFailure = closeFailure;

  await expect(database.close()).rejects.toBe(closeFailure);

  expect(engine.closeSteps).toEqual(["status", "close"]);
  expect(logCaughtError).toHaveBeenCalledExactlyOnceWith(
    "DatabaseExecutor",
    statusFailure,
  );
  expect(loggedEvents()).not.toContain("database.closed");
});

it("still closes the worker when even the report of the failure fails", async () => {
  const logFailure = new Error("logging failed");
  const database = await Database.create(IN_MEMORY_DATABASE_PATH);
  engine.statusFailure = new Error("status failed");
  vi.mocked(logCaughtError).mockImplementationOnce(() => {
    throw logFailure;
  });

  // The close ran, but the stop cannot confirm it through a broken logger.
  await expect(database.close()).rejects.toBe(logFailure);

  expect(engine.released).toEqual(["worker"]);
  expect(loggedEvents()).not.toContain("database.closed");
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
