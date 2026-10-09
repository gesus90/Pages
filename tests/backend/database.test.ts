import { copyFile, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { DuckDBInstance } from "@duckdb/node-api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  Database,
  IN_MEMORY_DATABASE_PATH,
  isUniqueViolationOn,
} from "@/backend/database/Database";
import {
  MigrationChecksumError,
  UnknownMigrationError,
} from "@/backend/database/Migration";

const CREATE_ITEMS = "CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT);";

describe("Database", () => {
  let database: Database;
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "pages-duckdb-"));
    database = await Database.create(IN_MEMORY_DATABASE_PATH);
  });

  afterEach(async () => {
    await database.close();
    await rm(directory, { force: true, recursive: true });
  });

  describe("opening and closing", () => {
    it("creates missing parent directories and keeps data across restarts", async () => {
      const filePath = path.join(directory, "nested", "pages.duckdb");
      const fileDatabase = await Database.create(filePath);

      await fileDatabase.execute(CREATE_ITEMS);
      await fileDatabase.execute("INSERT INTO items VALUES (1, 'kept');");
      await fileDatabase.close();

      const reopened = await Database.create(filePath);

      await expect(reopened.query("SELECT label FROM items;")).resolves.toEqual(
        [["kept"]],
      );
      await reopened.close();
    });

    it("replays a write-ahead log that DuckDB cannot replay on its own", async () => {
      const original = path.join(directory, "running.duckdb");
      const crashed = path.join(directory, "crashed.duckdb");
      const instance = await DuckDBInstance.create(original);
      const connection = await instance.connect();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      await connection.run(
        "CREATE MACRO utc_now() AS strftime(now(), '%Y-%m-%d %H:%M:%S');" +
          "CREATE TABLE items (id INTEGER, created_at TEXT DEFAULT utc_now());" +
          "CHECKPOINT;" +
          "ALTER TABLE items ADD COLUMN label TEXT;" +
          "INSERT INTO items (id, label) VALUES (1, 'kept');",
      );
      // The files of a running process are what an unclean stop leaves.
      await copyFile(original, crashed);
      await copyFile(`${original}.wal`, `${crashed}.wal`);
      connection.closeSync();
      instance.closeSync();

      const recovered = await Database.create(crashed);

      await expect(
        recovered.query("SELECT id, label FROM items;"),
      ).resolves.toEqual([[1, "kept"]]);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("Replayed the write-ahead log"),
      );
      await recovered.close();
    });

    it("rethrows other failures to open a file", async () => {
      const filePath = path.join(directory, "foreign.duckdb");

      await writeFile(filePath, "no database at all");

      await expect(Database.create(filePath)).rejects.toThrow();
    });

    it("finishes queued statements before it closes", async () => {
      const filePath = path.join(directory, "pages.duckdb");
      const fileDatabase = await Database.create(filePath);

      await fileDatabase.execute(CREATE_ITEMS);
      const pendingInsert = fileDatabase.execute(
        "INSERT INTO items VALUES (1, 'queued');",
      );
      await fileDatabase.close();
      await pendingInsert;

      const reopened = await Database.create(filePath);

      await expect(reopened.query("SELECT label FROM items;")).resolves.toEqual(
        [["queued"]],
      );
      await reopened.close();
    });

    it("sorts NULL values like SQLite did", async () => {
      await database.execute(
        "CREATE TABLE ranks (id INTEGER, rank INTEGER); INSERT INTO ranks VALUES (1, 2), (2, NULL), (3, 1);",
      );

      await expect(
        database.query("SELECT id FROM ranks ORDER BY rank ASC, id;"),
      ).resolves.toEqual([[2], [3], [1]]);
      await expect(
        database.query("SELECT id FROM ranks ORDER BY rank DESC, id;"),
      ).resolves.toEqual([[1], [3], [2]]);
    });

    it("offers utc_after to compute times relative to now", async () => {
      const [[past, future]] = await database.query(
        "SELECT utc_after(to_minutes(-1)), utc_after(to_days(14));",
      );
      const [[now]] = await database.query("SELECT utc_now();");

      expect(String(past) < String(now)).toBe(true);
      expect(String(future) > String(now)).toBe(true);
    });

    it("offers the utc_now function in the stored timestamp format", async () => {
      const [[timestamp]] = await database.query("SELECT utc_now();");

      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u);
    });
  });

  describe("statements", () => {
    beforeEach(async () => {
      await database.execute(
        "CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT, flag INTEGER, payload BLOB);",
      );
    });

    it("binds named parameters of every supported type", async () => {
      await database.execute(
        "INSERT INTO items VALUES ($id, $label, $flag, $payload);",
        { flag: true, id: 1, label: "first", payload: Buffer.from([1, 2, 3]) },
      );
      await database.execute(
        "INSERT INTO items VALUES ($id, $label, $flag, $payload);",
        { flag: false, id: 2, label: null, payload: null },
      );

      await expect(
        database.query(
          "SELECT id, label, flag, payload FROM items ORDER BY id;",
        ),
      ).resolves.toEqual([
        [1, "first", 1, Buffer.from([1, 2, 3])],
        [2, null, 0, null],
      ]);
    });

    it("returns counts as plain numbers and keeps unsafe integers as bigint", async () => {
      await expect(
        database.query(
          "SELECT COUNT(*), 9007199254740993::BIGINT, CAST(SUM(id) AS BIGINT) FROM items;",
        ),
      ).resolves.toEqual([[0, 9007199254740993n, null]]);
    });

    it("returns boolean results as 0 or 1", async () => {
      await expect(database.query("SELECT TRUE, FALSE;")).resolves.toEqual([
        [1, 0],
      ]);
    });

    it("rejects values of types repositories do not read", async () => {
      await expect(database.query("SELECT DATE '2026-01-01';")).rejects.toThrow(
        "unsupported type",
      );
    });

    it("runs several statements without parameters in one call", async () => {
      await database.execute(
        "INSERT INTO items (id) VALUES (1); INSERT INTO items (id) VALUES (2);",
      );

      await expect(
        database.query("SELECT COUNT(*) FROM items;"),
      ).resolves.toEqual([[2]]);
    });

    it("rejects parameters the statement does not use", async () => {
      await expect(
        database.query("SELECT 1;", { unused: "value" }),
      ).rejects.toThrow();
    });

    it("keeps working after a statement failed", async () => {
      await expect(
        database.execute("INSERT INTO missing VALUES (1);"),
      ).rejects.toThrow("missing");

      await database.execute("INSERT INTO items (id) VALUES (1);");

      await expect(
        database.query("SELECT COUNT(*) FROM items;"),
      ).resolves.toEqual([[1]]);
    });

    it("runs parallel calls one after another in call order", async () => {
      await Promise.all(
        Array.from({ length: 50 }, (_, index) =>
          database.execute("INSERT INTO items (id) VALUES ($id);", {
            id: index,
          }),
        ),
      );

      await expect(
        database.query("SELECT COUNT(*), MIN(id), MAX(id) FROM items;"),
      ).resolves.toEqual([[50, 0, 49]]);
    });
  });

  describe("unique violations", () => {
    it("names the column whose constraint rejected a value", async () => {
      await database.execute(
        "CREATE TABLE people (id INTEGER PRIMARY KEY, email TEXT UNIQUE);",
      );
      await database.execute(
        "INSERT INTO people VALUES (1, 'a@example.invalid');",
      );

      const failure = await database
        .execute("INSERT INTO people VALUES (2, 'a@example.invalid');")
        .catch((error: unknown) => error);

      expect(isUniqueViolationOn(failure, "email")).toBe(true);
      expect(isUniqueViolationOn(failure, "id")).toBe(false);
    });

    it("ignores other errors and values that are no errors", () => {
      expect(isUniqueViolationOn(new Error("Disk full"), "email")).toBe(false);
      expect(isUniqueViolationOn("Duplicate key", "email")).toBe(false);
    });
  });

  describe("transactions", () => {
    beforeEach(async () => {
      await database.execute(CREATE_ITEMS);
    });

    it("commits the work and returns its result", async () => {
      const result = await database.transaction(async (transaction) => {
        await transaction.execute("INSERT INTO items VALUES (1, 'a');");

        return transaction.query("SELECT COUNT(*) FROM items;");
      });

      expect(result).toEqual([[1]]);
      await expect(
        database.query("SELECT COUNT(*) FROM items;"),
      ).resolves.toEqual([[1]]);
    });

    it("rolls back and rethrows when the work fails", async () => {
      await expect(
        database.transaction(async (transaction) => {
          await transaction.execute("INSERT INTO items VALUES (1, 'a');");

          throw new Error("work failed");
        }),
      ).rejects.toThrow("work failed");

      await expect(
        database.query("SELECT COUNT(*) FROM items;"),
      ).resolves.toEqual([[0]]);
    });

    it("keeps other callers out until the transaction ended", async () => {
      const failingTransaction = database.transaction(async (transaction) => {
        await transaction.execute("INSERT INTO items VALUES (1, 'a');");
        await new Promise((resolve) => setTimeout(resolve, 20));

        throw new Error("rolled back");
      });
      const concurrentCount = database.query("SELECT COUNT(*) FROM items;");

      await expect(failingTransaction).rejects.toThrow("rolled back");
      await expect(concurrentCount).resolves.toEqual([[0]]);
    });
  });

  describe("migrations", () => {
    const FIRST = { name: "001_items.sql", sql: CREATE_ITEMS };
    const SECOND = {
      name: "002_seed.sql",
      sql: "INSERT INTO items VALUES (1, 'seeded');",
    };

    it("applies migrations in name order and records them", async () => {
      await database.migrate([SECOND, FIRST]);

      await expect(database.query("SELECT label FROM items;")).resolves.toEqual(
        [["seeded"]],
      );
      await expect(
        database.query("SELECT name FROM schema_migrations ORDER BY name;"),
      ).resolves.toEqual([["001_items.sql"], ["002_seed.sql"]]);
    });

    it("skips migrations that were applied before", async () => {
      await database.migrate([FIRST, SECOND]);
      await database.migrate([FIRST, SECOND]);

      await expect(
        database.query("SELECT COUNT(*) FROM items;"),
      ).resolves.toEqual([[1]]);
    });

    it("applies only the new migrations on a later start", async () => {
      await database.migrate([FIRST]);
      await database.migrate([FIRST, SECOND]);

      await expect(
        database.query("SELECT COUNT(*) FROM schema_migrations;"),
      ).resolves.toEqual([[2]]);
    });

    it("refuses an applied migration that was edited", async () => {
      await database.migrate([FIRST]);

      await expect(
        database.migrate([{ ...FIRST, sql: `${CREATE_ITEMS} -- edited` }]),
      ).rejects.toBeInstanceOf(MigrationChecksumError);
    });

    it("refuses a database that is ahead of the known migrations", async () => {
      await database.migrate([FIRST, SECOND]);

      await expect(database.migrate([FIRST])).rejects.toBeInstanceOf(
        UnknownMigrationError,
      );
    });

    it("rolls a failing migration back completely", async () => {
      const failing = {
        name: "002_broken.sql",
        sql: "CREATE TABLE half_done (id INTEGER); SELECT * FROM missing_table;",
      };

      await database.migrate([FIRST]);

      await expect(database.migrate([FIRST, failing])).rejects.toMatchObject({
        cause: expect.any(Error),
        message: 'Failed to apply database migration "002_broken.sql".',
      });
      await expect(
        database.query("SELECT COUNT(*) FROM schema_migrations;"),
      ).resolves.toEqual([[1]]);
      await expect(database.query("SELECT * FROM half_done;")).rejects.toThrow(
        "half_done",
      );
    });

    it("writes applied schema changes into the file instead of the log", async () => {
      const filePath = path.join(directory, "pages.duckdb");
      const fileDatabase = await Database.create(filePath);
      const logSize = async (): Promise<number> =>
        (await stat(`${filePath}.wal`).catch(() => ({ size: 0 }))).size;

      await fileDatabase.migrate([
        {
          name: "001_items.sql",
          sql: "CREATE TABLE items (id INTEGER, created_at TEXT DEFAULT utc_now());",
        },
      ]);
      await fileDatabase.migrate([
        {
          name: "001_items.sql",
          sql: "CREATE TABLE items (id INTEGER, created_at TEXT DEFAULT utc_now());",
        },
        {
          name: "002_label.sql",
          sql: "ALTER TABLE items ADD COLUMN label TEXT;",
        },
      ]);

      await expect(logSize()).resolves.toBe(0);
      await fileDatabase.close();
    });

    it("stamps applied migrations in the stored timestamp format", async () => {
      await database.migrate([FIRST]);

      const [[appliedAt]] = await database.query(
        "SELECT applied_at FROM schema_migrations;",
      );

      expect(appliedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u);
    });
  });
});
