import type { DuckDBValue } from "@duckdb/node-api";

/**
 * Reads a text column from a DuckDB result row.
 *
 * @param row - Row returned by a query.
 * @param index - Zero-based column position.
 * @param column - Column name used in error messages.
 * @returns The column value as text.
 * @throws When the column is missing or not textual.
 */
export function readTextColumn(
  row: readonly DuckDBValue[],
  index: number,
  column: string,
): string {
  const value = row[index];

  if (typeof value !== "string") {
    throw new Error(`Database returned an invalid value for "${column}".`);
  }

  return value;
}

/**
 * Reads a counting column from a DuckDB result row.
 *
 * @param row - Row returned by an aggregate query.
 * @param index - Zero-based column position.
 * @param column - Column name used in error messages.
 * @returns The column value as a number.
 * @throws When the column is missing or not numeric.
 */
export function readCountColumn(
  row: readonly DuckDBValue[],
  index: number,
  column: string,
): number {
  const value = row[index];

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "number") {
    return value;
  }

  throw new Error(`Database returned an invalid count for "${column}".`);
}
