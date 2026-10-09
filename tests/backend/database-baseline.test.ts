import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import SqliteDatabase from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Database, IN_MEMORY_DATABASE_PATH } from "@/backend/database/Database";
import { DATABASE_MIGRATIONS } from "@/backend/database/Migrations";

const LEGACY_MIGRATIONS_DIRECTORY = fileURLToPath(
  new URL("../../backend/database/migrations", import.meta.url),
);

interface SqliteColumn {
  readonly name: string;
  readonly notnull: number;
  readonly pk: number;
}

/** Applies the frozen SQLite migrations to an in-memory database. */
function createLegacySchema(): SqliteDatabase.Database {
  const legacy = new SqliteDatabase(":memory:");

  // Table rebuilds in the legacy migrations need enforcement switched off,
  // exactly like the former migration runner did.
  legacy.pragma("foreign_keys = OFF");

  for (const fileName of readdirSync(LEGACY_MIGRATIONS_DIRECTORY).sort()) {
    legacy.exec(
      readFileSync(path.join(LEGACY_MIGRATIONS_DIRECTORY, fileName), "utf8"),
    );
  }

  return legacy;
}

function describeLegacyTables(
  legacy: SqliteDatabase.Database,
): Map<string, Map<string, boolean>> {
  const tableNames = legacy
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name;",
    )
    .pluck()
    .all() as string[];

  return new Map(
    tableNames.map((tableName) => {
      const columns = legacy
        .prepare(`PRAGMA table_info("${tableName}");`)
        .all() as SqliteColumn[];

      return [
        tableName,
        new Map(
          columns.map((column) => [
            column.name,
            column.notnull === 0 && column.pk === 0,
          ]),
        ),
      ];
    }),
  );
}

async function describeDuckDbTables(
  database: Database,
): Promise<Map<string, Map<string, boolean>>> {
  const rows = await database.query(
    `
      SELECT
          table_name,
          column_name,
          is_nullable = 'YES' AS is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'main'
          AND table_name <> 'schema_migrations'
      ORDER BY table_name, ordinal_position;
    `,
  );
  const tables = new Map<string, Map<string, boolean>>();

  for (const [tableName, columnName, isNullable] of rows) {
    const columns = tables.get(String(tableName)) ?? new Map();

    columns.set(String(columnName), isNullable === 1);
    tables.set(String(tableName), columns);
  }

  return tables;
}

describe("DuckDB baseline migration", () => {
  let database: Database;

  beforeEach(async () => {
    database = await Database.create(IN_MEMORY_DATABASE_PATH);
    // Only the baseline mirrors the SQLite schema; later migrations add to it.
    await database.migrate(
      DATABASE_MIGRATIONS.filter(
        (migration) => migration.name === "001_baseline.sql",
      ),
    );
  });

  afterEach(async () => {
    await database.close();
  });

  it("embeds the migration scripts by their file names", () => {
    expect(DATABASE_MIGRATIONS.map((migration) => migration.name)).toEqual([
      "001_baseline.sql",
      "002_instance_settings.sql",
      "003_username_case_insensitive.sql",
      "004_password_change_required.sql",
      "005_user_authorization.sql",
      "006_legacy_user_roles.sql",
      "007_project_departments.sql",
      "008_project_permissions.sql",
      "009_work_item_departments.sql",
      "010_project_templates.sql",
      "011_project_activity_work_items.sql",
      "012_user_groups.sql",
      "013_global_labels.sql",
      "014_work_item_templates.sql",
      "015_github_sync_switch.sql",
      "016_user_board_preferences.sql",
      "017_ticket_number_counter.sql",
      "018_instance_logo.sql",
      "019_wiki.sql",
      "020_agent_connections.sql",
      "021_agent_model_catalogs.sql",
      "022_agent_reasoning_effort.sql",
      "023_wiki_page_cover.sql",
      "024_ticket_attachments_and_tree.sql",
      "025_text_assistant.sql",
      "026_agent_function_assignments.sql",
    ]);
  });

  it("creates the tables and columns of the final SQLite schema", async () => {
    const legacy = createLegacySchema();

    const expected = describeLegacyTables(legacy);
    const actual = await describeDuckDbTables(database);

    legacy.close();

    expect([...actual.keys()].sort()).toEqual([...expected.keys()].sort());

    for (const [tableName, columns] of expected) {
      expect(
        Object.fromEntries(actual.get(tableName) ?? []),
        `columns of ${tableName}`,
      ).toEqual(Object.fromEntries(columns));
    }
  });

  it("seeds the default workflow statuses like the SQLite migrations did", async () => {
    const legacy = createLegacySchema();
    const expected = legacy
      .prepare(
        "SELECT id, project_id, key, name, position, is_done FROM workflow_statuses ORDER BY position;",
      )
      .raw()
      .all();

    legacy.close();

    await expect(
      database.query(
        "SELECT id, project_id, key, name, position, is_done FROM workflow_statuses ORDER BY position;",
      ),
    ).resolves.toEqual(expected);
  });

  it("fills timestamp defaults with the stored UTC text format", async () => {
    await database.execute(
      `
        INSERT INTO users (
            id,
            username,
            display_name,
            password_hash,
            role
        )
        VALUES (
            'user-1',
            'admin',
            'Administrator',
            'hash',
            'admin'
        );
      `,
    );

    const [[createdAt, updatedAt]] = await database.query(
      "SELECT created_at, updated_at FROM users;",
    );

    expect(createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u);
    expect(updatedAt).toBe(createdAt);
  });

  it("keeps the unique and check constraints", async () => {
    const insertUser = (id: string, username: string, role: string) =>
      database.execute(
        `
          INSERT INTO users (
              id,
              username,
              display_name,
              password_hash,
              role
          )
          VALUES (
              $id,
              $username,
              'Name',
              'hash',
              $role
          );
        `,
        { id, role, username },
      );

    await insertUser("user-1", "admin", "admin");

    await expect(insertUser("user-2", "admin", "admin")).rejects.toThrow();
    await expect(insertUser("user-3", "other", "owner")).rejects.toThrow();
  });

  it("lets users with related rows change their unique columns", async () => {
    await database.execute(
      `
        INSERT INTO users (id, username, display_name, password_hash, role)
        VALUES ('user-1', 'admin', 'Admin', 'hash', 'admin');
        INSERT INTO sessions (id, user_id, token_hash, expires_at)
        VALUES ('session-1', 'user-1', 'token', '2999-01-01 00:00:00');
      `,
    );

    await database.execute(
      "UPDATE users SET username = 'root', email = 'root@example.invalid' WHERE id = 'user-1';",
    );

    await expect(
      database.query("SELECT username, email FROM users;"),
    ).resolves.toEqual([["root", "root@example.invalid"]]);
  });
});
