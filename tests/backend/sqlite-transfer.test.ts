import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import SqliteDatabase from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Database } from "@/backend/database/Database";
import { DATABASE_MIGRATIONS } from "@/backend/database/Migrations";
import {
  transferSqliteToDuckDb,
  TransferError,
} from "@/backend/database/legacy/SqliteTransfer";

import {
  createLegacyDatabase,
  fillLegacyDatabase,
  listLegacyMigrationNames,
} from "../helpers/legacy-sqlite";

import type { DatabaseValue } from "@/backend/database/Database";
import type { TransferOptions } from "@/backend/database/legacy/SqliteTransfer";

const TABLE_COUNT = 26;

/** Makes values of both engines comparable: binary data as hex, integers as numbers. */
function normalize(value: unknown): unknown {
  if (Buffer.isBuffer(value)) {
    return `blob:${value.toString("hex")}`;
  }

  return typeof value === "bigint" ? Number(value) : value;
}

function hashFile(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

describe("transferSqliteToDuckDb", { timeout: 30_000 }, () => {
  let directory: string;
  let sourcePath: string;
  let targetPath: string;

  function createOptions(): TransferOptions {
    return {
      legacyMigrationNames: listLegacyMigrationNames(),
      migrations: DATABASE_MIGRATIONS,
      sourcePath,
      targetPath,
    };
  }

  /** Creates the source file; `prepare` fills or changes it before it closes. */
  function createSource(
    prepare: (legacy: SqliteDatabase.Database) => void = fillLegacyDatabase,
  ): void {
    const legacy = createLegacyDatabase(sourcePath);

    prepare(legacy);
    legacy.close();
  }

  async function readTargetRows(
    table: string,
  ): Promise<readonly (readonly DatabaseValue[])[]> {
    const target = await Database.create(targetPath);

    try {
      return await target.query(`SELECT * FROM ${table};`);
    } finally {
      await target.close();
    }
  }

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "pages-transfer-"));
    sourcePath = path.join(directory, "pages.db");
    targetPath = path.join(directory, "data", "pages.duckdb");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(directory, { force: true, recursive: true });
  });

  describe("copying", () => {
    it("can still target the historical schema without authorization migrations", async () => {
      createSource();
      const result = await transferSqliteToDuckDb({
        ...createOptions(),
        migrations: DATABASE_MIGRATIONS.filter(
          (migration) => migration.name < "005",
        ),
      });
      expect(result.status).toBe("copied");
    });

    it("copies every row of every table and reports matching counts", async () => {
      createSource();

      const result = await transferSqliteToDuckDb(createOptions());

      expect(result.status).toBe("copied");
      expect(result.tables).toHaveLength(TABLE_COUNT);
      const target = await Database.create(targetPath);
      try {
        expect(
          await target.query("SELECT COUNT(*) FROM user_authorization;"),
        ).toEqual([[2]]);
        expect(
          await target.query("SELECT COUNT(*) FROM project_departments;"),
        ).toEqual([[0]]);
        expect(await target.query("SELECT COUNT(*) FROM departments;")).toEqual(
          [[0]],
        );
        expect(
          await target.query(
            "SELECT COUNT(*) FROM role_permissions WHERE permission IN ('create_projects', 'archive_projects');",
          ),
        ).toEqual([[0]]);
        expect(
          await target.query(
            "SELECT COUNT(*) FROM role_permissions WHERE permission = 'manage_roles';",
          ),
        ).toEqual([[0]]);
      } finally {
        await target.close();
      }

      for (const table of result.tables) {
        expect(table.sourceRows, table.table).toBeGreaterThan(0);
        expect(table.targetRows, table.table).toBe(table.sourceRows);
      }
    });

    it("keeps the content of every table, including NULLs and binary data", async () => {
      createSource();
      const legacy = new SqliteDatabase(sourcePath, { readonly: true });

      await transferSqliteToDuckDb(createOptions());

      const tables = legacy
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name <> 'schema_migrations' ORDER BY name;",
        )
        .pluck()
        .all() as string[];
      const target = await Database.create(targetPath);

      for (const table of tables) {
        const columnRows = legacy
          .prepare(`PRAGMA table_info(${table});`)
          .all() as { name: string }[];
        const columns = columnRows.map((row) => row.name).join(", ");
        const expected = legacy
          .prepare(`SELECT ${columns} FROM ${table};`)
          .raw()
          .all()
          .map((row) => JSON.stringify((row as unknown[]).map(normalize)))
          .sort();
        const actual = (await target.query(`SELECT ${columns} FROM ${table};`))
          .map((row) => JSON.stringify(row.map(normalize)))
          .sort();

        expect(actual, `rows of ${table}`).toEqual(expected);
      }

      expect(
        await target.query("SELECT must_change_password FROM users;"),
      ).toEqual([[0], [0]]);
      await target.close();
      legacy.close();
    });

    it("replaces the default workflow statuses with the ones of the source", async () => {
      createSource();

      await transferSqliteToDuckDb(createOptions());

      const names = (await readTargetRows("workflow_statuses")).map(
        (row) => row[3],
      );

      expect(names).toContain("In Bearbeitung");
      expect(names).not.toContain("In Arbeit");
    });

    it("copies a database without any rows", async () => {
      createSource(() => undefined);

      const result = await transferSqliteToDuckDb(createOptions());

      expect(result.status).toBe("copied");
      expect(
        result.tables.find((table) => table.table === "users")?.targetRows,
      ).toBe(0);
    });

    it("copies tables whose size is not a multiple of the batch size", async () => {
      createSource((legacy) => {
        fillLegacyDatabase(legacy);
        const insertTag = legacy.prepare(
          "INSERT INTO project_tags (project_id, tag) VALUES ('p1', ?);",
        );

        for (let index = 0; index < 250; index += 1) {
          insertTag.run(`tag-${index}`);
        }
      });

      const result = await transferSqliteToDuckDb(createOptions());

      expect(
        result.tables.find((table) => table.table === "project_tags"),
      ).toMatchObject({ sourceRows: 252, targetRows: 252 });
    });

    it("copies tables whose size is a multiple of the batch size", async () => {
      createSource((legacy) => {
        const insertTag = legacy.prepare(
          "INSERT INTO project_tags (project_id, tag) VALUES ('p1', ?);",
        );

        for (let index = 0; index < 200; index += 1) {
          insertTag.run(`tag-${index}`);
        }
      });

      const result = await transferSqliteToDuckDb(createOptions());

      expect(
        result.tables.find((table) => table.table === "project_tags"),
      ).toMatchObject({ sourceRows: 200, targetRows: 200 });
    });

    it("fills a target that was migrated but holds no data yet", async () => {
      createSource();
      const blankTarget = await Database.create(targetPath);

      await blankTarget.migrate(DATABASE_MIGRATIONS);
      await blankTarget.close();

      const result = await transferSqliteToDuckDb(createOptions());

      expect(result.status).toBe("copied");
      expect(await readTargetRows("users")).toHaveLength(2);
    });
  });

  describe("source protection", () => {
    it("never changes the source file", async () => {
      createSource();
      const before = hashFile(sourcePath);

      await transferSqliteToDuckDb(createOptions());

      expect(hashFile(sourcePath)).toBe(before);
    });
  });

  describe("repeating the transfer", () => {
    it("does nothing when the target already holds the rows of the source", async () => {
      createSource();
      await transferSqliteToDuckDb(createOptions());

      const result = await transferSqliteToDuckDb(createOptions());

      expect(result.status).toBe("already-transferred");
      expect(
        result.tables.every((table) => table.sourceRows === table.targetRows),
      ).toBe(true);
      expect(await readTargetRows("users")).toHaveLength(2);
    });

    it("refuses to merge into a target that holds different data", async () => {
      createSource();
      await transferSqliteToDuckDb(createOptions());
      const legacy = new SqliteDatabase(sourcePath);

      legacy.exec(
        "INSERT INTO project_tags (project_id, tag) VALUES ('p1', 'new');",
      );
      legacy.close();

      await expect(transferSqliteToDuckDb(createOptions())).rejects.toThrow(
        "differs from the source",
      );
      expect(await readTargetRows("project_tags")).toHaveLength(2);
    });
  });

  describe("unusable sources", () => {
    it("reports a missing source file", async () => {
      await expect(transferSqliteToDuckDb(createOptions())).rejects.toThrow(
        TransferError,
      );
      expect(existsSync(targetPath)).toBe(false);
    });

    it("reports a database without migration history", async () => {
      createSource((legacy) => legacy.exec("DROP TABLE schema_migrations;"));

      await expect(transferSqliteToDuckDb(createOptions())).rejects.toThrow(
        "does not have the current schema",
      );
    });

    it("names the migrations an outdated source lacks", async () => {
      const [lastMigration] = listLegacyMigrationNames().slice(-1);

      createSource((legacy) =>
        legacy
          .prepare("DELETE FROM schema_migrations WHERE name = ?;")
          .run(lastMigration),
      );

      await expect(transferSqliteToDuckDb(createOptions())).rejects.toThrow(
        `missing ${lastMigration}`,
      );
    });

    it("reports a table the source lacks", async () => {
      createSource((legacy) => legacy.exec("DROP TABLE wiki_pages;"));

      await expect(transferSqliteToDuckDb(createOptions())).rejects.toThrow(
        'no table "wiki_pages"',
      );
      expect(existsSync(targetPath)).toBe(false);
    });

    it("reports columns the source lacks and leaves no target behind", async () => {
      createSource((legacy) =>
        legacy.exec("ALTER TABLE users DROP COLUMN avatar_icon;"),
      );

      await expect(transferSqliteToDuckDb(createOptions())).rejects.toThrow(
        'table "users" lacks the columns avatar_icon',
      );
      expect(existsSync(targetPath)).toBe(false);
    });
  });

  describe("failures during the copy", () => {
    function createBrokenSource(): void {
      // SQLite stores text in an INTEGER column; DuckDB cannot convert it.
      createSource((legacy) => {
        fillLegacyDatabase(legacy);
        legacy.exec("UPDATE work_item_checklist_items SET sort_order = 'x';");
      });
    }

    it("removes a target that the failed transfer created", async () => {
      createBrokenSource();

      await expect(transferSqliteToDuckDb(createOptions())).rejects.toThrow();
      expect(existsSync(targetPath)).toBe(false);
      expect(existsSync(`${targetPath}.wal`)).toBe(false);
    });

    it("rolls back completely into a target that existed before", async () => {
      createBrokenSource();
      const blankTarget = await Database.create(targetPath);

      await blankTarget.migrate(DATABASE_MIGRATIONS);
      await blankTarget.close();

      await expect(transferSqliteToDuckDb(createOptions())).rejects.toThrow();

      expect(existsSync(targetPath)).toBe(true);
      expect(await readTargetRows("users")).toEqual([]);
      expect(await readTargetRows("workflow_statuses")).toHaveLength(5);
    });

    it("rejects the transfer when the source changes while it is copied", async () => {
      createSource();
      const concurrentWriter = new SqliteDatabase(sourcePath);
      const originalTransaction = Database.prototype.transaction;
      let transactionCount = 0;

      // One transaction per migration builds the schema, the next one copies.
      vi.spyOn(Database.prototype, "transaction").mockImplementation(function (
        this: Database,
        work,
      ) {
        transactionCount += 1;

        if (transactionCount === DATABASE_MIGRATIONS.length + 1) {
          concurrentWriter.exec(
            "INSERT INTO project_tags (project_id, tag) VALUES ('p1', 'late');",
          );
        }

        return originalTransaction.call(this, work);
      });

      await expect(transferSqliteToDuckDb(createOptions())).rejects.toThrow(
        'Table "project_tags" has 3 rows after the copy, expected 2.',
      );
      expect(existsSync(targetPath)).toBe(false);

      concurrentWriter.close();
    });
  });
});
