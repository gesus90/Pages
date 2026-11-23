import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  logEvent: vi.fn(),
  logCaught: vi.fn(),
  recordTransaction: vi.fn(() => false),
  finish: vi.fn(() => ({ queries: 1 })),
  start: vi.fn(),
  requireLocale: vi.fn(),
  collectGarbage: vi.fn(),
  storeClose: vi.fn(),
  storeDirectories: [] as string[],
}));
vi.mock("@/backend/logging/Logger", () => ({
  logEvent: mocks.logEvent,
  logCaughtError: mocks.logCaught,
}));
vi.mock("@/backend/logging/DatabaseLogMetrics", () => ({
  recordDatabaseTransaction: mocks.recordTransaction,
  withDatabaseLogMetrics: <T>(
    work: (metrics: { finish: () => object }) => Promise<T>,
  ) => work({ finish: mocks.finish }),
}));
vi.mock("@/backend/storage/AgentPayloadFileStore", () => ({
  AgentPayloadFileStore: class {
    public close = mocks.storeClose;
    public collectGarbage = mocks.collectGarbage;
    public constructor(directory: string) {
      mocks.storeDirectories.push(directory);
    }
  },
}));
vi.mock("@/backend/database/postgres/PostgresExecutor", () => ({
  PostgresExecutor: { start: mocks.start },
}));
vi.mock("@/backend/database/postgres/PostgresLocale", () => ({
  requireByteOrderedDatabase: mocks.requireLocale,
}));

import {
  Database,
  isUniqueViolationOn,
  type DatabaseTransaction,
} from "@/backend/database/Database";
import { afterCallCommit } from "@/backend/database/CallTransaction";
import { DatabaseOutcomeUnknownError } from "@/backend/database/executor/DatabaseExecutorErrors";
import { withManagementAudit } from "@/backend/database/ManagementAuditContext";
import { withReadScope } from "@/backend/database/ReadScope";

import type { DatabaseExecutorStatus } from "@/backend/database/DatabaseExecutorTypes";

const writerRun = vi.fn();
const engine = {
  write: vi.fn(
    (work: (writer: { run: typeof writerRun }) => Promise<unknown>) =>
      work({ run: writerRun }),
  ),
  read: vi.fn(),
  readSession: vi.fn(
    (work: (session: { query: typeof sessionQuery }) => Promise<unknown>) =>
      work({ query: sessionQuery }),
  ),
  status: vi.fn(() => ({ status: true }) as unknown as DatabaseExecutorStatus),
  close: vi.fn(() => Promise.resolve()),
};
const sessionQuery = vi.fn();

async function open(directory?: string): Promise<Database> {
  return Database.connect("postgres://u:p@h/db", directory);
}

const statementsRun = (): string[] =>
  writerRun.mock.calls.map((call) => call[0] as string);

beforeEach(() => {
  mocks.storeDirectories.length = 0;
  mocks.recordTransaction.mockReturnValue(false);
  writerRun.mockReset().mockResolvedValue([]);
  engine.read.mockReset().mockResolvedValue([["row"]]);
  sessionQuery.mockReset().mockResolvedValue([["snap"]]);
  mocks.start.mockReset().mockResolvedValue(engine);
  mocks.requireLocale.mockReset().mockResolvedValue(undefined);
});

it("recognizes unique violations of a column", () => {
  const violation = (detail: unknown, code = "23505"): Error =>
    Object.assign(new Error("dup"), { code, detail });
  expect(isUniqueViolationOn("x", "a")).toBe(false);
  expect(isUniqueViolationOn(new Error("x"), "a")).toBe(false);
  expect(isUniqueViolationOn(violation("Key (a)=(1)"), "a")).toBe(true);
  expect(isUniqueViolationOn(violation("Key (a, b)=(1, 2)"), "a")).toBe(true);
  expect(isUniqueViolationOn(violation("Key (b)=(1)"), "a")).toBe(false);
  expect(isUniqueViolationOn(violation("Key (a)=(1)", "23503"), "a")).toBe(
    false,
  );
  expect(isUniqueViolationOn(violation(5), "a")).toBe(false);
  expect(
    isUniqueViolationOn(Object.assign(new Error("x"), { code: "23505" }), "a"),
  ).toBe(false);
});

it("connects, reports status and closes", async () => {
  const database = await open("/data");
  expect(mocks.storeDirectories).toEqual(["/data"]);
  expect(database.agentFiles).toBeDefined();
  expect(database.executorStatus()).toEqual({ status: true });
  await database.close();
  expect(mocks.storeClose).toHaveBeenCalled();
  expect(engine.close).toHaveBeenCalled();
  const plain = await open();
  expect(plain.agentFiles).toBeUndefined();
  await plain.close();
});

it("logs and rethrows when the database cannot be opened", async () => {
  mocks.start.mockRejectedValue(
    Object.assign(new Error("auth"), { code: "28P01" }),
  );
  await expect(open()).rejects.toThrow("auth");
  expect(mocks.logEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      event: "database.open_failed",
      metadata: { code: "28P01" },
    }),
  );
});

it("releases the pool of a database with the wrong locale", async () => {
  mocks.requireLocale.mockRejectedValue(new Error("locale"));
  await expect(open()).rejects.toThrow("locale");
  expect(engine.close).toHaveBeenCalled();
});

function appliedRows(...rows: [string, string][]): void {
  engine.read.mockResolvedValue(rows);
}

it("applies only unseen migrations in name order", async () => {
  const { createMigrationChecksum } =
    await import("@/backend/database/Migration");
  appliedRows(["001_a.sql", createMigrationChecksum("A")]);
  const database = await open();
  await database.migrate([
    { name: "003_c.sql", sql: "C" },
    { name: "001_a.sql", sql: "A" },
    { name: "002_b.sql", sql: "B" },
  ]);
  expect(
    statementsRun().filter((text) => text === "B" || text === "C"),
  ).toEqual(["B", "C"]);
  expect(mocks.collectGarbage).not.toHaveBeenCalled();
});

it("refuses unknown and edited migrations", async () => {
  appliedRows(["999.sql", "x"]);
  const database = await open();
  await expect(
    database.migrate([{ name: "001.sql", sql: "A" }]),
  ).rejects.toThrow("999.sql");
  appliedRows(["001.sql", "other"]);
  await expect(
    database.migrate([{ name: "001.sql", sql: "A" }]),
  ).rejects.toThrow("001.sql");
});

it("names the migration that failed", async () => {
  appliedRows();
  writerRun.mockImplementation((statement: string) =>
    statement === "BAD"
      ? Promise.reject(new Error("syntax"))
      : Promise.resolve([]),
  );
  const database = await open();
  await expect(
    database.migrate([{ name: "001.sql", sql: "BAD" }]),
  ).rejects.toThrow('Failed to apply database migration "001.sql".');
});

it("collects payload files once the payload migration is known", async () => {
  appliedRows();
  const withFiles = await open("/data");
  await withFiles.migrate([{ name: "011_agent_payload_files.sql", sql: "P" }]);
  expect(mocks.collectGarbage).toHaveBeenCalledTimes(1);
  await withFiles.transaction(() => Promise.resolve());
  expect(mocks.collectGarbage).toHaveBeenCalledTimes(2);
  mocks.collectGarbage.mockClear();
  const without = await open();
  await without.migrate([{ name: "011_agent_payload_files.sql", sql: "P" }]);
  await without.transaction(() => Promise.resolve());
  expect(mocks.collectGarbage).not.toHaveBeenCalled();
});

it("executes statements as writer jobs", async () => {
  const database = await open();
  await database.execute("UPDATE t SET a = 1");
  expect(writerRun).toHaveBeenCalledWith("UPDATE t SET a = 1", {}, "execute");
});

it("routes queries by their kind", async () => {
  const database = await open();
  writerRun.mockResolvedValue([["w"]]);
  await expect(
    database.query("UPDATE t SET a = 1 RETURNING a"),
  ).resolves.toEqual([["w"]]);
  expect(writerRun).toHaveBeenCalledWith(
    "UPDATE t SET a = 1 RETURNING a",
    {},
    "rows",
  );
  await expect(database.query("SELECT now()")).resolves.toEqual([["row"]]);
  await expect(database.query("SELECT 1")).resolves.toEqual([["row"]]);
  expect(engine.read).toHaveBeenCalledTimes(2);
});

it("answers repeated reads of a scope once until a write", async () => {
  const database = await open();
  await withReadScope(async () => {
    await database.query("SELECT 2", { a: 1 });
    await database.query("SELECT 2", { a: 1 });
    expect(engine.read).toHaveBeenCalledTimes(1);
    await database.execute("DELETE FROM t");
    await database.query("SELECT 2", { a: 1 });
    expect(engine.read).toHaveBeenCalledTimes(2);
    await database.query("SELECT 2", { a: Buffer.from("x") });
    await database.query("SELECT 2", { a: Buffer.from("x") });
    expect(engine.read).toHaveBeenCalledTimes(4);
    await database.query("SELECT now()");
    await database.query("SELECT now()");
    expect(engine.read).toHaveBeenCalledTimes(6);
  });
});

it("runs own transactions with commit and file effects", async () => {
  mocks.recordTransaction.mockReturnValue(true);
  const database = await open("/data");
  const order: string[] = [];
  const result = await database.transaction(async (transaction) => {
    transaction.onCommit?.(() => {
      order.push("commit");
      return Promise.resolve();
    });
    transaction.onRollback?.(() => Promise.resolve());
    await transaction.execute("INSERT INTO t VALUES (1)");
    await transaction.query("SELECT 1");
    return "ok";
  });
  expect(result).toBe("ok");
  expect(statementsRun()).toEqual([
    "BEGIN TRANSACTION;",
    "INSERT INTO t VALUES (1)",
    "SELECT 1",
    "COMMIT;",
  ]);
  expect(order).toEqual(["commit"]);
  expect(mocks.logEvent).not.toHaveBeenCalledWith(
    expect.objectContaining({ event: "database.transaction.committed" }),
  );
});

it("logs a committed top-level transaction and skips COMMIT when idle", async () => {
  const database = await open();
  await database.transaction(() => Promise.resolve());
  expect(writerRun).not.toHaveBeenCalled();
  expect(mocks.logEvent).toHaveBeenCalledWith(
    expect.objectContaining({ event: "database.transaction.committed" }),
  );
});

it("records the management actor in the transaction", async () => {
  const database = await open();
  await withManagementAudit("admin", () =>
    database.transaction((transaction) => transaction.execute("DELETE FROM t")),
  );
  expect(writerRun).toHaveBeenCalledWith(
    expect.stringContaining("pages.management_actor"),
    { actor: "admin" },
    "rows",
  );
});

it("rolls back a failing transaction and runs its rollback effects in reverse", async () => {
  const database = await open();
  const order: string[] = [];
  await expect(
    database.transaction(async (transaction) => {
      transaction.onRollback?.(() => {
        order.push("first");
        return Promise.resolve();
      });
      transaction.onRollback?.(() => Promise.reject(new Error("cleanup")));
      transaction.onRollback?.(() => {
        order.push("last");
        return Promise.resolve();
      });
      await transaction.execute("DELETE FROM t");
      throw new Error("work");
    }),
  ).rejects.toThrow("work");
  expect(statementsRun().at(-1)).toBe("ROLLBACK;");
  expect(order).toEqual(["last", "first"]);
  expect(mocks.logCaught).toHaveBeenCalledWith(
    "DatabaseFileEffects",
    expect.any(Error),
  );
});

it("keeps the original error when the rollback fails too", async () => {
  const database = await open();
  writerRun.mockImplementation((statement: string) =>
    statement === "ROLLBACK;"
      ? Promise.reject(new Error("rb"))
      : Promise.resolve([]),
  );
  await expect(
    database.transaction(async (transaction) => {
      await transaction.execute("DELETE FROM t");
      throw new Error("work");
    }),
  ).rejects.toThrow("work");
});

it("reports a commit with an unknown outcome without effects", async () => {
  const database = await open();
  const effect = vi.fn(() => Promise.resolve());
  writerRun.mockImplementation((statement: string) =>
    statement === "COMMIT;"
      ? Promise.reject(new DatabaseOutcomeUnknownError())
      : Promise.resolve([]),
  );
  await expect(
    database.transaction(async (transaction) => {
      transaction.onCommit?.(effect);
      transaction.onRollback?.(effect);
      await transaction.execute("DELETE FROM t");
    }),
  ).rejects.toBeInstanceOf(DatabaseOutcomeUnknownError);
  expect(effect).not.toHaveBeenCalled();
  expect(mocks.logEvent).toHaveBeenCalledWith(
    expect.objectContaining({ event: "database.transaction.outcome_unknown" }),
  );
});

it("rolls back after a commit that failed with another error", async () => {
  const database = await open();
  writerRun.mockImplementation((statement: string) =>
    statement === "COMMIT;"
      ? Promise.reject(new Error("commit"))
      : Promise.resolve([]),
  );
  await expect(
    database.transaction((transaction) => transaction.execute("DELETE FROM t")),
  ).rejects.toThrow("commit");
  expect(statementsRun().at(-1)).toBe("ROLLBACK;");
});

it("does not count a transaction that only read as a write", async () => {
  const database = await open();
  await withReadScope(async () => {
    await database.query("SELECT 3");
    await database.transaction((transaction) => transaction.query("SELECT 4"));
    await database.query("SELECT 3");
    expect(engine.read).toHaveBeenCalledTimes(1);
    await database.transaction((transaction) =>
      transaction.query("DELETE FROM t RETURNING a"),
    );
    await database.query("SELECT 3");
    expect(engine.read).toHaveBeenCalledTimes(2);
  });
});

it("runs a call as one transaction and keeps effects for the commit", async () => {
  const database = await open();
  const effects: string[] = [];
  const finish = vi.fn(() => Promise.resolve());
  const result = await database.runCall(async () => {
    await database.execute("INSERT INTO t VALUES (1)");
    await afterCallCommit(() => {
      effects.push("after");
      return Promise.resolve();
    });
    expect(effects).toEqual([]);
    await expect(database.query("SELECT 1")).resolves.toEqual([]);
    return "value";
  }, finish);
  expect(result).toBe("value");
  expect(finish).toHaveBeenCalledWith(
    expect.objectContaining({ result: "value", isNested: false }),
  );
  expect(effects).toEqual(["after"]);
  expect(statementsRun().at(-1)).toBe("COMMIT;");
});

it("rolls a failing call back and drops its effects", async () => {
  const database = await open();
  const effect = vi.fn(() => Promise.resolve());
  await expect(
    database.runCall(
      async () => {
        await database.execute("INSERT INTO t VALUES (1)");
        await afterCallCommit(effect);
        throw new Error("call");
      },
      () => Promise.resolve(),
    ),
  ).rejects.toThrow("call");
  expect(effect).not.toHaveBeenCalled();
  expect(statementsRun().at(-1)).toBe("ROLLBACK;");
  await expect(
    database.runCall(
      () => Promise.reject("plain"),
      () => Promise.resolve(),
    ),
  ).rejects.toBe("plain");
});

it("opens a call at its first write when asked to", async () => {
  const database = await open();
  const finish = vi.fn(() => Promise.resolve());
  await database.runCall(() => Promise.resolve(1), finish, {
    opensAtFirstWrite: true,
  });
  expect(finish).not.toHaveBeenCalled();
  expect(writerRun).not.toHaveBeenCalled();
  await database.runCall(
    async () => {
      await database.query("SELECT 1");
      await database.execute("INSERT INTO t VALUES (1)");
    },
    finish,
    { opensAtFirstWrite: true },
  );
  expect(finish).toHaveBeenCalledTimes(1);
});

it("joins a call inside another call", async () => {
  const database = await open();
  const innerFinish = vi.fn(() => Promise.resolve());
  await database.runCall(
    async () => {
      await database.runCall(() => Promise.resolve(1), innerFinish);
      await database.runCall(() => Promise.resolve(2), innerFinish, {
        opensAtFirstWrite: true,
      });
    },
    () => Promise.resolve(),
  );
  expect(innerFinish).toHaveBeenCalledTimes(2);
  const lazy = vi.fn(() => Promise.resolve());
  await database.runCall(
    async () => {
      await database.runCall(() => Promise.resolve(1), lazy);
    },
    () => Promise.resolve(),
    { opensAtFirstWrite: true },
  );
  expect(lazy).not.toHaveBeenCalled();
});

it("runs nested transactions of a call as savepoints", async () => {
  const database = await open();
  const log: string[] = [];
  await database.runCall(
    async () => {
      await database.transaction(async (transaction) => {
        transaction.onCommit?.(() => {
          log.push("commit");
          return Promise.resolve();
        });
        transaction.onRollback?.(() => {
          log.push("rollback-kept");
          return Promise.resolve();
        });
        await transaction.execute("INSERT INTO t VALUES (1)");
      });
      await expect(
        database.transaction(async (transaction) => {
          transaction.onRollback?.(() => {
            log.push("rollback");
            return Promise.resolve();
          });
          await Promise.resolve(transaction);
          throw new Error("nested");
        }),
      ).rejects.toThrow("nested");
    },
    () => Promise.resolve(),
  );
  expect(statementsRun()).toEqual(
    expect.arrayContaining([
      "SAVEPOINT pages_call_1;",
      "RELEASE SAVEPOINT pages_call_1;",
      "SAVEPOINT pages_call_2;",
      "ROLLBACK TO SAVEPOINT pages_call_2;",
    ]),
  );
  expect(log).toEqual(["rollback", "commit"]);
});

it("reads on a snapshot", async () => {
  const database = await open("/data");
  await withReadScope(async () => {
    const run = (): Promise<unknown> =>
      database.readTransaction(async (transaction) => {
        await expect(transaction.execute("DELETE FROM t")).rejects.toThrow(
          "cannot change",
        );
        await expect(transaction.query("DELETE FROM t")).rejects.toThrow(
          "cannot change",
        );
        expect(transaction.agentFiles).toBeDefined();
        await transaction.query("SELECT 5");
        await transaction.query("SELECT 5", {});
        await transaction.query("SELECT 5", { a: Buffer.from("x") });
        await transaction.query("SELECT now()");
        return transaction.query("SELECT 6");
      });
    await run();
    expect(sessionQuery).toHaveBeenCalledTimes(4);
    await run();
    expect(sessionQuery).toHaveBeenCalledTimes(6);
  });
  await expect(
    database.readTransaction((transaction) => transaction.query("SELECT 7")),
  ).resolves.toEqual([["snap"]]);
});

it("reads inside the open transaction of a call", async () => {
  const database = await open();
  await database.runCall(
    async () => {
      await database.readTransaction(
        async (transaction: DatabaseTransaction) => {
          await expect(transaction.execute("DELETE FROM t")).rejects.toThrow(
            "cannot change",
          );
          await expect(transaction.query("DELETE FROM t")).rejects.toThrow(
            "cannot change",
          );
          await expect(transaction.query("SELECT 1")).resolves.toEqual([]);
          await expect(
            transaction.query("SELECT 1", { a: 1 }),
          ).resolves.toEqual([]);
        },
      );
    },
    () => Promise.resolve(),
  );
});
