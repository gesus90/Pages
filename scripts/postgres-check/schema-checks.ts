import { strict as assert } from "node:assert";

import { Database } from "@/backend/database/Database";
import {
  MigrationChecksumError,
  UnknownMigrationError,
} from "@/backend/database/Migration";

import { parseMigrationSchema } from "@/tests/backend/backend/database/repositories/migration-schema";

import { readMigrations } from "../read-database-migrations";
import { compareSchemas } from "./schema-comparison";
import { checkLegacySchema } from "./legacy-schema-check";
import { readSchemaShape } from "./schema-shape";

import type { DatabaseValue } from "@/backend/database/Database";
import type { Migration } from "@/backend/database/Migration";
import type { SchemaShape, TableShape } from "./schema-shape";
import type { TemporaryPostgres } from "./temporary-instance";

const SCHEMA_DATABASE_NAME = "pages_schema_check";
const STORED_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u;
/** Longest distance between two readings of the clock in this check. */
const CLOCK_TOLERANCE_MS = 10_000;
const SECONDS_TO_MS = 1000;

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
const READ_FIXED_TIMES = `
    SELECT
        to_char(TIMESTAMP '2024-01-31 23:59:59.999999' + INTERVAL '1 month', 'YYYY-MM-DD HH24:MI:SS'),
        to_char(TIMESTAMP '2024-02-29 12:00:00' + INTERVAL '1 year', 'YYYY-MM-DD HH24:MI:SS'),
        to_char(TIMESTAMP '2026-03-29 01:59:59' + INTERVAL '1 hour', 'YYYY-MM-DD HH24:MI:SS'),
        to_char(TIMESTAMP '2026-01-01 00:00:00' + INTERVAL '-1 second', 'YYYY-MM-DD HH24:MI:SS');
`;

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

/** Checks table and column declarations against the independently parsed migration text. */
function checkDeclaredTables(
  shape: SchemaShape,
  migrations: readonly Migration[],
): void {
  const declared = new Map(parseMigrationSchema(migrations));
  declared.set("postgres_schema_migrations", [
    "name",
    "checksum",
    "applied_at",
  ]);
  assert.deepEqual(
    [...shape.tables.keys()].sort(),
    [...declared.keys()].sort(),
  );
  for (const [name, columns] of declared) {
    const table = shape.tables.get(name);
    assert.ok(table, name);
    assert.deepEqual(
      table.columns.map((column) => column.name),
      columns,
      name,
    );
  }
}

/** Compares the names of independently declared indexes, sequences and views. */
function checkDeclaredObjects(
  shape: SchemaShape,
  migrations: readonly Migration[],
): void {
  const text = migrations
    .map((migration) => migration.sql.replace(/--.*$/gmu, ""))
    .join("\n");
  const declarations: readonly [RegExp, ReadonlyMap<string, unknown>][] = [
    [
      /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/giu,
      shape.indexes,
    ],
    [
      /\bCREATE\s+SEQUENCE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/giu,
      shape.sequences,
    ],
    [/\bCREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(\w+)/giu, shape.views],
  ];
  for (const [pattern, actual] of declarations) {
    const names = [...text.matchAll(pattern)].map((match) => match[1]);
    if (actual === shape.sequences) names.push(...identitySequences(text));
    assert.deepEqual([...actual.keys()].sort(), names.sort());
  }
}

/** PostgreSQL creates a named sequence for every declared identity column. */
function identitySequences(text: string): string[] {
  const tables = text.matchAll(
    /\bCREATE\s+TABLE\s+(\w+)\s*\(([\s\S]*?)\n\);/giu,
  );
  return [...tables].flatMap(([, table, body]) =>
    [
      ...body.matchAll(
        /^\s*(\w+)\s+\w+\s+GENERATED\s+(?:ALWAYS|BY\s+DEFAULT)\s+AS\s+IDENTITY\b/gimu,
      ),
    ].map(([, column]) => `${table}_${column}_seq`),
  );
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

async function checkUtcFunctions(postgres: Database): Promise<void> {
  const startedAt = Date.now();
  checkUtcResults(await readUtcResults(postgres), startedAt);
  assert.deepEqual(await postgres.query(READ_FIXED_TIMES), [
    [
      "2024-02-29 23:59:59",
      "2025-02-28 12:00:00",
      "2026-03-29 02:59:59",
      "2025-12-31 23:59:59",
    ],
  ]);
  await checkSessionTimeZone(postgres);
}

/**
 * Builds a new empty PostgreSQL database and verifies its migrations and catalog.
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
    await checkUtcFunctions(database);
    const shape = await readSchemaShape(database);
    checkComparisonFindsDifferences(shape);
    checkDeclaredTables(shape, migrations);
    checkDeclaredObjects(shape, migrations);
    await checkLegacySchema(instance, database);
    assert.equal(await fingerprint(database), afterFirstRun);
  } finally {
    await database.close();
  }
}
