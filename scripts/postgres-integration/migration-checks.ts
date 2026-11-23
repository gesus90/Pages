import assert from "node:assert/strict";

import { Database } from "../../backend/database/Database";
import {
  createMigrationChecksum,
  MigrationChecksumError,
  UnknownMigrationError,
} from "../../backend/database/Migration";

import { runCheck, singleNumber } from "./check-support";

import type { Migration } from "../../backend/database/Migration";
import type { CheckResult, IntegrationContext } from "./check-support";

/**
 * The documented earlier schema version of the upgrade check: the schema
 * after this migration, the last one before tickets lost their single
 * department column. Installations on it exist, so the check keeps it fixed.
 */
export const UPGRADE_BASE_MIGRATION = "040_agent_plan_one_shot.sql";

const LATER_THAN_EVERY_MIGRATION = "999_integration_failing.sql";

/** Opens a database, runs the work and always closes it again. */
async function withDatabase<Result>(
  url: string,
  work: (database: Database) => Promise<Result>,
): Promise<Result> {
  const database = await Database.connect(url);
  try {
    return await work(database);
  } finally {
    await database.close();
  }
}

async function appliedNames(database: Database): Promise<readonly string[]> {
  const rows = await database.query(
    "SELECT name FROM postgres_schema_migrations ORDER BY name;",
  );
  return rows.map((row) => String(row[0]));
}

async function checkFullChain(context: IntegrationContext): Promise<string> {
  const url = await context.createDatabase("full_chain");
  const expected = context.migrations.map((migration) => migration.name);
  return withDatabase(url, async (database) => {
    await database.migrate(context.migrations);
    assert.deepEqual(await appliedNames(database), expected);
    // A second run finds everything applied and changes nothing.
    await database.migrate(context.migrations);
    assert.deepEqual(await appliedNames(database), expected);
    const tables = singleNumber(
      await database.query(
        "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';",
      ),
    );
    assert.ok(tables > expected.length / 4, "The schema holds too few tables.");
    return `${String(expected.length)} migrations applied to an empty database, ${String(tables)} tables, a second run changed nothing`;
  });
}

async function insertUpgradeFixtures(database: Database): Promise<void> {
  await database.execute(
    `
      INSERT INTO work_items (
          id, project_id, key, number, type, title, status_id, created_by, department_id
      )
      VALUES
          ('fixture-ticket-1', 'fixture-project', 'FIXTURE-1', 1, 'task', 'Alpha', 'todo', 'fixture-user', 'fixture-department'),
          ('fixture-ticket-2', 'fixture-project', 'FIXTURE-2', 2, 'task', 'Beta', 'todo', 'fixture-user', NULL);
    `,
  );
  await database.execute(
    `
      INSERT INTO pages_event_outbox (
          kind, object_id, audience_project_id, audience_department_id
      )
      VALUES
          ('ticket.deleted', 'fixture-ticket-1', 'fixture-project', 'fixture-department'),
          ('ticket.created', 'fixture-ticket-2', 'fixture-project', NULL);
    `,
  );
}

async function checkUpgrade(context: IntegrationContext): Promise<string> {
  const baseIndex = context.migrations.findIndex(
    (migration) => migration.name === UPGRADE_BASE_MIGRATION,
  );
  assert.ok(baseIndex >= 0, `${UPGRADE_BASE_MIGRATION} no longer exists.`);
  const url = await context.createDatabase("upgrade");
  return withDatabase(url, async (database) => {
    await database.migrate(context.migrations.slice(0, baseIndex + 1));
    await insertUpgradeFixtures(database);

    await database.migrate(context.migrations);

    assert.deepEqual(
      await appliedNames(database),
      context.migrations.map((migration) => migration.name),
    );
    const tickets = await database.query(
      "SELECT id, title FROM work_items ORDER BY id;",
    );
    assert.deepEqual(tickets, [
      ["fixture-ticket-1", "Alpha"],
      ["fixture-ticket-2", "Beta"],
    ]);
    // The single department column became a set; a ticket without one has no row.
    assert.deepEqual(
      await database.query(
        "SELECT work_item_id, department_id FROM work_item_departments ORDER BY work_item_id;",
      ),
      [["fixture-ticket-1", "fixture-department"]],
    );
    assert.deepEqual(
      await database.query(
        "SELECT object_id, audience_department_ids FROM pages_event_outbox ORDER BY object_id;",
      ),
      [
        ["fixture-ticket-1", '["fixture-department"]'],
        ["fixture-ticket-2", "[]"],
      ],
    );
    return `upgraded from the schema after ${UPGRADE_BASE_MIGRATION} with fixtures: tickets kept, departments and outbox audiences moved`;
  });
}

async function checkFailingMigration(
  context: IntegrationContext,
): Promise<string> {
  const url = await context.createDatabase("failing_migration");
  const good: Migration = {
    name: "000_integration_good.sql",
    sql: "CREATE TABLE integration_good (id INTEGER PRIMARY KEY);",
  };
  const failing: Migration = {
    name: LATER_THAN_EVERY_MIGRATION,
    sql: "CREATE TABLE integration_partial (id INTEGER); SELECT 1 / 0;",
  };
  return withDatabase(url, async (database) => {
    await assert.rejects(
      database.migrate([good, failing]),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes(
          `Failed to apply database migration "${LATER_THAN_EVERY_MIGRATION}"`,
        ),
    );
    // The migration before it stays; the failing one leaves no trace at all.
    assert.deepEqual(await appliedNames(database), [good.name]);
    const partial = await database.query(
      "SELECT to_regclass('integration_partial') IS NOT NULL;",
    );
    assert.equal(partial[0]?.[0], 0, "A failed migration left its table.");
    return "a failing migration made migrate fail, was rolled back completely and kept the earlier migration";
  });
}

async function checkGuards(context: IntegrationContext): Promise<string> {
  const url = await context.createDatabase("migration_guards");
  const first: Migration = {
    name: "000_integration_first.sql",
    sql: "CREATE TABLE integration_first (id INTEGER PRIMARY KEY);",
  };
  const second: Migration = {
    name: "001_integration_second.sql",
    sql: "CREATE TABLE integration_second (id INTEGER PRIMARY KEY);",
  };
  return withDatabase(url, async (database) => {
    await database.migrate([first, second]);
    const edited = { ...first, sql: `${first.sql} -- edited` };
    assert.notEqual(
      createMigrationChecksum(edited.sql),
      createMigrationChecksum(first.sql),
    );
    await assert.rejects(
      database.migrate([edited, second]),
      MigrationChecksumError,
    );
    await assert.rejects(database.migrate([first]), UnknownMigrationError);
    assert.deepEqual(await appliedNames(database), [first.name, second.name]);
    return "an edited applied migration and a database ahead of the code are both refused";
  });
}

/**
 * Runs the checks of the migration chain.
 * @param context - The run.
 * @returns One result per check.
 */
export async function runMigrationChecks(
  context: IntegrationContext,
): Promise<readonly CheckResult[]> {
  return [
    await runCheck("migrations on an empty database", () =>
      checkFullChain(context),
    ),
    await runCheck("upgrade from the documented earlier schema", () =>
      checkUpgrade(context),
    ),
    await runCheck("failing migration fails the run", () =>
      checkFailingMigration(context),
    ),
    await runCheck("edited and unknown migrations are refused", () =>
      checkGuards(context),
    ),
  ];
}
