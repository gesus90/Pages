import { strict as assert } from "node:assert";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Database } from "@/backend/database/Database";
import { sqlForDialect } from "@/backend/database/DatabaseDialect";
import {
  MigrationChecksumError,
  UnknownMigrationError,
} from "@/backend/database/Migration";

import { compareSchemas, SCHEMA_DEVIATIONS } from "./schema-comparison";
import { readSchemaShape } from "./schema-shape";

import type { DatabaseValue } from "@/backend/database/Database";
import type { DialectSql } from "@/backend/database/DatabaseDialect";
import type { Migration } from "@/backend/database/Migration";
import type { SchemaShape, TableShape } from "./schema-shape";
import type { TemporaryPostgres } from "./temporary-instance";

const DATABASE_DIRECTORY = fileURLToPath(
  new URL("../../backend/database/", import.meta.url),
);
const SCHEMA_DATABASE_NAME = "pages_schema_check";
const STORED_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u;
/** Longest distance between two readings of the clock in this check. */
const CLOCK_TOLERANCE_MS = 10_000;
const SECONDS_TO_MS = 1000;
const CANONICAL_CONSTRAINT = "postgres_check_canonical";

const READ_VERSION_ROWS = `
  SELECT
      name,
      checksum,
      applied_at,
      xmin::TEXT
  FROM postgres_schema_migrations
  ORDER BY name;
`;

const READ_UTC_FUNCTIONS = `
  SELECT
      utc_now(),
      utc_after(INTERVAL '0 days'),
      utc_after(INTERVAL '-30 seconds'),
      utc_after(INTERVAL '1 hour'),
      utc_after(INTERVAL '3 days'),
      utc_after(INTERVAL '1 month');
`;

/** The expected distance from now per column of {@link READ_UTC_FUNCTIONS}; a month has no fixed one. */
const UTC_SHIFT_SECONDS = [0, 0, -30, 3600, 259_200, null] as const;

/** The arithmetic and format of the functions on times that cannot be waited for. */
const READ_FIXED_TIMES: DialectSql = {
  duckdb: `
    SELECT
        strftime(TIMESTAMP '2024-01-31 23:59:59.999999' + INTERVAL '1 month', '%Y-%m-%d %H:%M:%S'),
        strftime(TIMESTAMP '2024-02-29 12:00:00' + INTERVAL '1 year', '%Y-%m-%d %H:%M:%S'),
        strftime(TIMESTAMP '2026-03-29 01:59:59' + INTERVAL '1 hour', '%Y-%m-%d %H:%M:%S'),
        strftime(TIMESTAMP '2026-01-01 00:00:00' + INTERVAL '-1 second', '%Y-%m-%d %H:%M:%S');
  `,
  postgres: `
    SELECT
        to_char(TIMESTAMP '2024-01-31 23:59:59.999999' + INTERVAL '1 month', 'YYYY-MM-DD HH24:MI:SS'),
        to_char(TIMESTAMP '2024-02-29 12:00:00' + INTERVAL '1 year', 'YYYY-MM-DD HH24:MI:SS'),
        to_char(TIMESTAMP '2026-03-29 01:59:59' + INTERVAL '1 hour', 'YYYY-MM-DD HH24:MI:SS'),
        to_char(TIMESTAMP '2026-01-01 00:00:00' + INTERVAL '-1 second', 'YYYY-MM-DD HH24:MI:SS');
  `,
};

/**
 * Reads the scripts from disk: `Migrations.ts` needs the Vite build, this check runs without it.
 *
 * @param directory - The directory of the scripts below `backend/database/`.
 * @returns The migrations in name order.
 */
export async function readMigrations(
  directory: string,
): Promise<readonly Migration[]> {
  const root = path.join(DATABASE_DIRECTORY, directory);
  const names = (await readdir(root)).filter((name) => name.endsWith(".sql"));
  return Promise.all(
    names.sort().map(async (name) => ({
      name,
      sql: await readFile(path.join(root, name), "utf8"),
    })),
  );
}

function storedTimeToMs(text: unknown): number {
  assert.ok(typeof text === "string" && STORED_TIME.test(text), String(text));
  return Date.parse(`${text.replace(" ", "T")}Z`);
}

async function versionRows(
  database: Database,
): Promise<readonly DatabaseValue[][]> {
  return database.query(READ_VERSION_ROWS);
}

/** Applies the baseline to the empty database and reads what a repeat must not change. */
async function checkFirstRun(
  instance: TemporaryPostgres,
  migrations: readonly Migration[],
): Promise<string> {
  const database = await Database.connect(
    instance.urlOfDatabase(SCHEMA_DATABASE_NAME),
  );
  try {
    assert.equal((await readSchemaShape(database)).tables.size, 0);
    await database.migrate(migrations);
    const rows = await versionRows(database);
    assert.deepEqual(
      rows.map((row) => row[0]),
      migrations.map((migration) => migration.name),
    );
    storedTimeToMs(rows[0]?.[2]);
    return await fingerprint(database);
  } finally {
    await database.close();
  }
}

async function fingerprint(database: Database): Promise<string> {
  const shape = await readSchemaShape(database);
  return JSON.stringify(
    [
      [...shape.tables],
      [...shape.views],
      [...shape.indexes],
      [...shape.sequences],
      await versionRows(database),
    ],
    (_key, cell: unknown) => (typeof cell === "bigint" ? String(cell) : cell),
  );
}

async function checkRefusals(
  database: Database,
  migrations: readonly Migration[],
): Promise<void> {
  const [baseline, ...later] = migrations;
  assert.ok(baseline);
  await assert.rejects(
    database.migrate([
      { ...baseline, sql: `${baseline.sql}\n-- edited\n` },
      ...later,
    ]),
    MigrationChecksumError,
  );
  await assert.rejects(database.migrate([]), UnknownMigrationError);

  const before = await fingerprint(database);
  await assert.rejects(
    database.migrate([
      ...migrations,
      {
        name: "999_broken.sql",
        sql: "CREATE TABLE check_broken (id INTEGER); SELECT 1 / 0;",
      },
    ]),
  );
  assert.equal(await fingerprint(database), before);
}

/** A comparison that cannot fail proves nothing, so it has to find what is tampered with. */
function checkComparisonFindsDifferences(shape: SchemaShape): void {
  const [first, second, third, fourth] = shape.tables.keys();
  assert.ok(first && second && third && fourth);
  const tampered = new Map(shape.tables);
  const change = (
    name: string,
    patch: (table: TableShape) => TableShape,
  ): void => {
    const table = tampered.get(name);
    assert.ok(table);
    tampered.set(name, patch(table));
  };
  tampered.delete(first);
  change(second, (table) => ({ ...table, columns: table.columns.slice(1) }));
  change(third, (table) => ({
    ...table,
    columns: table.columns.map((column) => ({
      ...column,
      isNullable: !column.isNullable,
    })),
  }));
  change(fourth, (table) => ({ ...table, keys: [] }));
  const findings = compareSchemas(shape, { ...shape, tables: tampered });
  for (const expected of [
    `table only in DuckDB: ${first}`,
    `column order of ${second}`,
    `column ${third}.`,
    `keys of ${fourth}`,
  ])
    assert.ok(
      findings.some((finding) => finding.startsWith(expected)),
      `The comparison misses: ${expected}`,
    );
}

/**
 * Lets PostgreSQL write each DuckDB check in its own notation.
 *
 * @remarks
 * PostgreSQL rewrites `x IN (…)` and `BETWEEN` when it stores a check, so the
 * texts of the two catalogs only compare after both went through its parser.
 */
async function withCanonicalChecks(
  postgres: Database,
  shape: SchemaShape,
): Promise<SchemaShape> {
  const tables = new Map<string, TableShape>();
  await postgres.transaction(async (transaction) => {
    for (const [name, table] of shape.tables) {
      const checks: string[] = [];
      for (const check of table.checks) {
        await transaction.execute(
          `ALTER TABLE "${name}" ADD CONSTRAINT ${CANONICAL_CONSTRAINT} ${check};`,
        );
        const rows = await transaction.query(
          `
            SELECT pg_get_constraintdef(oid)
            FROM pg_constraint
            WHERE conname = $name;
          `,
          { name: CANONICAL_CONSTRAINT },
        );
        checks.push(String(rows[0]?.[0]));
        await transaction.execute(
          `ALTER TABLE "${name}" DROP CONSTRAINT ${CANONICAL_CONSTRAINT};`,
        );
      }
      tables.set(name, { ...table, checks: checks.sort() });
    }
  });
  return { ...shape, tables };
}

/** Applies all DuckDB migrations to a new file of the check and reads what they built. */
async function withFreshDuckDb<Result>(
  instance: TemporaryPostgres,
  work: (database: Database) => Promise<Result>,
): Promise<Result> {
  const database = await Database.create(
    path.join(instance.directory, "schema-check.duckdb"),
  );
  try {
    await database.migrate(await readMigrations("migrations"));
    return await work(database);
  } finally {
    await database.close();
  }
}

function checkFindings(duckdb: SchemaShape, postgres: SchemaShape): void {
  const findings = compareSchemas(duckdb, postgres);
  const listed = new Set(SCHEMA_DEVIATIONS.map((entry) => entry.finding));
  assert.deepEqual(
    findings.filter((finding) => !listed.has(finding)),
    [],
    "The schemas differ beyond the list of deliberate differences.",
  );
  assert.deepEqual(
    [...listed].filter((finding) => !findings.includes(finding)),
    [],
    "The list names a difference that no longer exists.",
  );
}

async function readUtcResults(
  database: Database,
): Promise<readonly DatabaseValue[]> {
  const rows = await database.query(READ_UTC_FUNCTIONS);
  assert.ok(rows[0]);
  return rows[0];
}

function checkUtcResults(
  results: readonly DatabaseValue[],
  startedAt: number,
): void {
  UTC_SHIFT_SECONDS.forEach((shift, index) => {
    const stored = storedTimeToMs(results[index]);
    if (shift === null) return;
    const distance = stored - shift * SECONDS_TO_MS - startedAt;
    assert.ok(Math.abs(distance) < CLOCK_TOLERANCE_MS, String(results[index]));
  });
}

/** The session time zone must not show, which is what `AT TIME ZONE 'UTC'` is for. */
async function checkSessionTimeZone(postgres: Database): Promise<void> {
  const startedAt = Date.now();
  const rows = await postgres.transaction(async (transaction) => {
    await transaction.execute("SET LOCAL TIME ZONE 'Asia/Tokyo';");
    return transaction.query("SELECT utc_now();");
  });
  const distance = storedTimeToMs(rows[0]?.[0]) - startedAt;
  assert.ok(Math.abs(distance) < CLOCK_TOLERANCE_MS);
}

async function checkUtcFunctions(
  duckdb: Database,
  postgres: Database,
): Promise<void> {
  const startedAt = Date.now();
  const [duckdbResults, postgresResults] = await Promise.all([
    readUtcResults(duckdb),
    readUtcResults(postgres),
  ]);
  checkUtcResults(duckdbResults, startedAt);
  checkUtcResults(postgresResults, startedAt);
  duckdbResults.forEach((result, index) => {
    const distance =
      storedTimeToMs(result) - storedTimeToMs(postgresResults[index]);
    assert.ok(Math.abs(distance) < CLOCK_TOLERANCE_MS);
  });
  const [duckdbFixed, postgresFixed] = await Promise.all(
    [duckdb, postgres].map((database) =>
      database.query(sqlForDialect(database.dialect, READ_FIXED_TIMES)),
    ),
  );
  assert.deepEqual(duckdbFixed, postgresFixed);
  await checkSessionTimeZone(postgres);
}

async function compareWithDuckDb(
  instance: TemporaryPostgres,
  postgres: Database,
): Promise<void> {
  const shapes = await withFreshDuckDb(instance, async (duckdb) => {
    await checkUtcFunctions(duckdb, postgres);
    console.info("ok   utc_now and utc_after: same results in both databases");
    return {
      duckdb: await withCanonicalChecks(
        postgres,
        await readSchemaShape(duckdb),
      ),
      postgres: await readSchemaShape(postgres),
    };
  });
  checkComparisonFindsDifferences(shapes.duckdb);
  checkFindings(shapes.duckdb, shapes.postgres);
  const columns = [...shapes.postgres.tables.values()].reduce(
    (sum, table) => sum + table.columns.length,
    0,
  );
  console.info(
    `ok   schema comparison: ${String(shapes.postgres.tables.size)} tables, ${String(columns)} columns, ${String(shapes.postgres.indexes.size)} indexes; only the ${String(SCHEMA_DEVIATIONS.length)} listed differences`,
  );
}

/**
 * Builds a new empty database through the migrations and compares it with DuckDB.
 *
 * @param instance - The running server.
 * @param administration - An open connection to create the database with.
 */
export async function runSchemaChecks(
  instance: TemporaryPostgres,
  administration: Database,
): Promise<void> {
  await administration.execute(`CREATE DATABASE ${SCHEMA_DATABASE_NAME};`);
  const migrations = await readMigrations("postgres/migrations");
  const afterFirstRun = await checkFirstRun(instance, migrations);
  console.info("ok   migrations: an empty database is built completely");

  const database = await Database.connect(
    instance.urlOfDatabase(SCHEMA_DATABASE_NAME),
  );
  try {
    await database.migrate(migrations);
    assert.equal(await fingerprint(database), afterFirstRun);
    console.info("ok   migrations: a second run changes nothing");
    await checkRefusals(database, migrations);
    console.info(
      "ok   migrations: edited, unknown and failing migrations are refused",
    );
    await compareWithDuckDb(instance, database);
    assert.equal(await fingerprint(database), afterFirstRun);
  } finally {
    await database.close();
  }
}
