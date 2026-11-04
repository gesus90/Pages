import type { ColumnShape, SchemaShape, TableShape } from "./schema-shape";

/** A difference the two schemas keep on purpose. */
export interface SchemaDeviation {
  readonly finding: string;
  readonly reason: string;
}

/**
 * Every deliberate difference, also listed in `docs/PostgresMigration.md`.
 *
 * @remarks
 * An entry nothing finds any more fails the check as well, so the list cannot
 * outlive its reason.
 */
export const SCHEMA_DEVIATIONS: readonly SchemaDeviation[] = [
  {
    finding: "table only in DuckDB: schema_migrations",
    reason:
      "The version table of the DuckDB migrations; PostgreSQL has its own migrations and counts them in its own table.",
  },
  {
    finding: "table only in PostgreSQL: postgres_schema_migrations",
    reason:
      "A table of its own, so a copied DuckDB version table can never count as applied PostgreSQL migrations.",
  },
];

function compareNames<T>(
  kind: string,
  duckdb: ReadonlyMap<string, T>,
  postgres: ReadonlyMap<string, T>,
): string[] {
  return [
    ...[...duckdb.keys()]
      .filter((name) => !postgres.has(name))
      .map((name) => `${kind} only in DuckDB: ${name}`),
    ...[...postgres.keys()]
      .filter((name) => !duckdb.has(name))
      .map((name) => `${kind} only in PostgreSQL: ${name}`),
  ];
}

function compareValues(
  label: string,
  duckdb: unknown,
  postgres: unknown,
): string[] {
  const duckdbText = JSON.stringify(duckdb);
  const postgresText = JSON.stringify(postgres);
  return duckdbText === postgresText
    ? []
    : [`${label}: DuckDB ${duckdbText}, PostgreSQL ${postgresText}`];
}

function compareColumns(
  owner: string,
  duckdb: readonly ColumnShape[],
  postgres: readonly ColumnShape[],
): string[] {
  const postgresColumns = new Map(
    postgres.map((column) => [column.name, column]),
  );
  const findings = compareValues(
    `column order of ${owner}`,
    duckdb.map((column) => column.name),
    postgres.map((column) => column.name),
  );
  for (const column of duckdb) {
    const other = postgresColumns.get(column.name);
    if (other === undefined) continue;
    const label = `column ${owner}.${column.name}`;
    findings.push(
      ...compareValues(`${label} type`, column.type, other.type),
      ...compareValues(
        `${label} nullable`,
        column.isNullable,
        other.isNullable,
      ),
      ...compareValues(
        `${label} default`,
        column.defaultValue,
        other.defaultValue,
      ),
    );
  }
  return findings;
}

function compareTable(
  name: string,
  duckdb: TableShape,
  postgres: TableShape,
): string[] {
  return [
    ...compareColumns(name, duckdb.columns, postgres.columns),
    ...compareValues(`keys of ${name}`, duckdb.keys, postgres.keys),
    ...compareValues(`checks of ${name}`, duckdb.checks, postgres.checks),
    ...compareValues(`rows of ${name}`, duckdb.rows, postgres.rows),
  ];
}

function compareTexts(
  kind: string,
  duckdb: ReadonlyMap<string, string>,
  postgres: ReadonlyMap<string, string>,
): string[] {
  const findings = compareNames(kind, duckdb, postgres);
  for (const [name, definition] of duckdb) {
    const other = postgres.get(name);
    if (other !== undefined)
      findings.push(...compareValues(`${kind} ${name}`, definition, other));
  }
  return findings;
}

/**
 * Lists every difference between two schemas.
 *
 * @param duckdb - The schema of the DuckDB database.
 * @param postgres - The schema of the PostgreSQL database.
 * @returns One line per difference, deliberate ones included.
 */
export function compareSchemas(
  duckdb: SchemaShape,
  postgres: SchemaShape,
): string[] {
  const findings = [
    ...compareNames("table", duckdb.tables, postgres.tables),
    ...compareNames("view", duckdb.views, postgres.views),
    ...compareTexts("index", duckdb.indexes, postgres.indexes),
    ...compareTexts("sequence", duckdb.sequences, postgres.sequences),
  ];
  for (const [name, table] of duckdb.tables) {
    const other = postgres.tables.get(name);
    if (other !== undefined) findings.push(...compareTable(name, table, other));
  }
  for (const [name, columns] of duckdb.views) {
    const other = postgres.views.get(name);
    if (other !== undefined)
      findings.push(...compareColumns(name, columns, other));
  }
  return findings;
}
