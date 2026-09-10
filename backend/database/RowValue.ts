import type { DatabaseValue } from "@/backend/database/Database";

/**
 * Reads a text column from a database result row.
 *
 * @param row - Row returned by a query.
 * @param index - Zero-based column position.
 * @param column - Column name used in error messages.
 * @returns The column value as text.
 * @throws When the column is missing or not textual.
 */
export function readTextColumn(
  row: readonly DatabaseValue[],
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
 * Reads a binary column from a database result row.
 *
 * @param row - Row returned by a query.
 * @param index - Zero-based column position.
 * @param column - Column name used in error messages.
 * @returns The column value as binary data.
 * @throws When the column is missing or not a SQLite BLOB.
 */
export function readBlobColumn(
  row: readonly DatabaseValue[],
  index: number,
  column: string,
): Buffer {
  const value = row[index];

  if (!Buffer.isBuffer(value)) {
    throw new Error(`Database returned an invalid value for "${column}".`);
  }

  return value;
}

/**
 * Reads a boolean column from a database result row.
 *
 * @param row - Row returned by a query.
 * @param index - Zero-based column position.
 * @param column - Column name used in error messages.
 * @returns The column value as a boolean.
 * @throws When the column is missing or not a SQLite `0`/`1` integer.
 *
 * @remarks
 * SQLite has no native boolean type, so boolean columns are stored and
 * returned as the integers `0` and `1`.
 */
export function readBooleanColumn(
  row: readonly DatabaseValue[],
  index: number,
  column: string,
): boolean {
  const value = row[index];

  if (value !== 0 && value !== 1) {
    throw new Error(`Database returned an invalid value for "${column}".`);
  }

  return value === 1;
}

/**
 * Reads a counting column from a database result row.
 *
 * @param row - Row returned by an aggregate query.
 * @param index - Zero-based column position.
 * @param column - Column name used in error messages.
 * @returns The column value as a number.
 * @throws When the column is missing or not numeric.
 */
export function readCountColumn(
  row: readonly DatabaseValue[],
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
