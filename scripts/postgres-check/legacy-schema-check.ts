import { strict as assert } from "node:assert";
import path from "node:path";

import { DuckDBBlobValue, DuckDBInstance } from "@duckdb/node-api";

import { Database } from "@/backend/database/Database";
import { readMigrations } from "../read-database-migrations";
import { readSchemaShape } from "./legacy-schema-shape";
import { compareSchemas, SCHEMA_DEVIATIONS } from "./schema-comparison";

import type { DuckDBValue } from "@duckdb/node-api";
import type { DatabaseValue } from "@/backend/database/Database";
import type { SchemaShape, TableShape } from "./schema-shape";
import type { TemporaryPostgres } from "./temporary-instance";

const CONNECTION_SETUP = `
  SET default_null_order = 'nulls_first_on_asc_last_on_desc';
  CREATE OR REPLACE MACRO utc_after(time_shift) AS
      strftime((now() AT TIME ZONE 'UTC') + time_shift, '%Y-%m-%d %H:%M:%S');
  CREATE OR REPLACE MACRO utc_now() AS utc_after(INTERVAL 0 DAY);
  CREATE OR REPLACE MACRO try_date(date_text) AS TRY_CAST(date_text AS DATE);
  CREATE OR REPLACE MACRO removes_nul_on_save() AS FALSE;
`;
const CANONICAL_CONSTRAINT = "postgres_check_canonical";
/** The last PostgreSQL migration paired with the frozen DuckDB transfer schema. */
const HISTORICAL_MIGRATION = "010_removes_nul_on_save.sql";
const HISTORICAL_DATABASE = "pages_historical_schema_check";

function toDatabaseValue(value: DuckDBValue): DatabaseValue {
  if (value === null || typeof value === "string" || typeof value === "number")
    return value;
  if (typeof value === "bigint")
    return Number.isSafeInteger(Number(value)) ? Number(value) : value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof DuckDBBlobValue) return Buffer.from(value.bytes);
  throw new Error("Legacy catalog returned an unsupported value.");
}

async function readLegacyShape(
  instance: TemporaryPostgres,
): Promise<SchemaShape> {
  const duckdb = await DuckDBInstance.create(
    path.join(instance.directory, "schema-check.duckdb"),
  );
  const connection = await duckdb.connect();
  try {
    await connection.run(CONNECTION_SETUP);
    await connection.run(`CREATE TABLE schema_migrations (
        name TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT utc_now()
    );`);
    for (const migration of await readMigrations("migrations"))
      await connection.run(migration.sql);
    return await readSchemaShape({
      dialect: "duckdb",
      query: async (statement) =>
        (await connection.runAndReadAll(statement))
          .getRows()
          .map((row) => row.map(toDatabaseValue)),
    });
  } finally {
    connection.closeSync();
    duckdb.closeSync();
  }
}

async function canonicalChecks(
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
          "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = $name;",
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

/** Compares the frozen offline catalog with its PostgreSQL counterpart, before PostgreSQL-only additions. */
export async function checkLegacySchema(
  instance: TemporaryPostgres,
  postgres: Database,
): Promise<void> {
  const migrations = (await readMigrations("postgres/migrations")).filter(
    (migration) => migration.name <= HISTORICAL_MIGRATION,
  );
  assert.equal(migrations.at(-1)?.name, HISTORICAL_MIGRATION);
  await postgres.execute(`CREATE DATABASE ${HISTORICAL_DATABASE};`);
  const historical = await Database.connect(
    instance.urlOfDatabase(HISTORICAL_DATABASE),
  );
  try {
    await historical.migrate(migrations);
    const legacy = await canonicalChecks(
      historical,
      await readLegacyShape(instance),
    );
    const current = await readSchemaShape({
      dialect: "postgres",
      query: (statement) => historical.query(statement),
    });
    const findings = compareSchemas(legacy, current);
    const listed = new Set(SCHEMA_DEVIATIONS.map((entry) => entry.finding));
    assert.deepEqual(
      findings.filter((finding) => !listed.has(finding)),
      [],
    );
    assert.deepEqual(
      [...listed].filter((finding) => !findings.includes(finding)),
      [],
    );
  } finally {
    await historical.close();
  }
}
