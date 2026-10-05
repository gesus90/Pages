import { readCountColumn, readTextColumn } from "@/backend/database/RowValue";

import type { DatabaseValue } from "@/backend/database/Database";

/**
 * Reads a text column that may be `NULL`.
 *
 * @param row - Row returned by a query.
 * @param index - Zero-based column position.
 * @param column - Column name used in error messages.
 * @returns The column value as text, or `null` when the column is `NULL`.
 * @throws When the column is missing or neither text nor `NULL`.
 *
 * @remarks
 * A missing column still throws, so a select list that drifts away from the
 * column positions of its mapper is never mistaken for a `NULL` value.
 */
export function readOptionalTextColumn(
  row: readonly DatabaseValue[],
  index: number,
  column: string,
): string | null {
  return row[index] === null ? null : readTextColumn(row, index, column);
}

/**
 * Reads a numeric column that may be `NULL`.
 *
 * @param row - Row returned by a query.
 * @param index - Zero-based column position.
 * @param column - Column name used in error messages.
 * @returns The column value as a number, or `null` when the column is `NULL`.
 * @throws When the column is missing or neither numeric nor `NULL`.
 */
export function readOptionalCountColumn(
  row: readonly DatabaseValue[],
  index: number,
  column: string,
): number | null {
  return row[index] === null ? null : readCountColumn(row, index, column);
}
