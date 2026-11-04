import { readTextColumn } from "@/backend/database/RowValue";

import { quoteIdentifier } from "../db-transfer/table-plan";

import type { DatabaseTransaction } from "@/backend/database/Database";

/** Not `information_schema`: it hides a table the role may not read, and so a loss. */
const READ_TABLES = `
  SELECT tablename
  FROM pg_tables
  WHERE schemaname = 'public'
  ORDER BY tablename;
`;

/** The rows per table of the schema `public`, sorted by table name. */
export type TableCounts = ReadonlyMap<string, bigint>;

/** Runs a query; both the facade and an open transaction can. */
export type TableReader = Pick<DatabaseTransaction, "query">;

/**
 * Reads the names of the tables of the schema `public`.
 *
 * @param reader - The connection to read from.
 * @returns The names, sorted.
 */
export async function readTableNames(
  reader: TableReader,
): Promise<readonly string[]> {
  const rows = await reader.query(READ_TABLES);
  return rows.map((row) => readTextColumn(row, 0, "tablename"));
}

/**
 * Counts the rows of the given tables.
 *
 * @param reader - The connection to read from.
 * @param tables - The names of the tables, as the catalog reports them.
 * @returns The rows per table.
 */
export async function countRows(
  reader: TableReader,
  tables: readonly string[],
): Promise<TableCounts> {
  const counts = new Map<string, bigint>();
  for (const table of tables) {
    const rows = await reader.query(
      `SELECT CAST(count(*) AS TEXT) FROM ${quoteIdentifier(table)};`,
    );
    const row = rows[0];
    if (row === undefined)
      throw new Error("A count returned no row in PostgreSQL.");
    counts.set(table, BigInt(readTextColumn(row, 0, "count")));
  }
  return counts;
}

/**
 * Lists every table whose presence or row count differs.
 *
 * @param expected - The counts of the source at the point in time.
 * @param restored - The counts of the restored instance.
 * @returns One line per difference, with names and numbers.
 */
export function compareCounts(
  expected: TableCounts,
  restored: TableCounts,
): readonly string[] {
  const names = [...new Set([...expected.keys(), ...restored.keys()])].sort();
  const deviations: string[] = [];
  for (const name of names) {
    const expectedRows = expected.get(name);
    const restoredRows = restored.get(name);
    if (expectedRows !== restoredRows)
      deviations.push(
        `${name}: ${String(expectedRows ?? "no table")} at the source, ${String(restoredRows ?? "no table")} restored`,
      );
  }
  return deviations;
}
