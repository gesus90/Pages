import { readTextColumn } from "../RowValue";

import type { DatabaseEngine } from "../DatabaseEngine";

/** Sort text by its bytes, as DuckDB does. */
const BYTE_ORDER_COLLATIONS: ReadonlySet<string> = new Set([
  "C",
  "POSIX",
  "C.UTF-8",
  "C.utf8",
]);

/** Change the case of every letter, as DuckDB does; plain `C` only knows ASCII. */
const UNICODE_CHARACTER_TYPES: ReadonlySet<string> = new Set([
  "C.UTF-8",
  "C.utf8",
]);

const LIBC_PROVIDER = "c";

const READ_DATABASE_LOCALE = `
  SELECT
      pg_encoding_to_char(encoding),
      datlocprovider::TEXT,
      datcollate,
      datctype
  FROM pg_database
  WHERE datname = current_database();
`;

/** The database sorts or changes case differently from what repositories rely on. */
export class PostgresLocaleError extends Error {
  public constructor() {
    super(
      "The PostgreSQL database needs the encoding UTF8 and the locale C.UTF-8. Create it with: CREATE DATABASE <name> TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER libc LOCALE 'C.UTF-8';",
    );
    this.name = "PostgresLocaleError";
  }
}

/**
 * Refuses a database whose text rules differ from those of DuckDB.
 *
 * @param engine - The open connection pool.
 * @throws {PostgresLocaleError} When the locale of the database does not fit.
 *
 * @remarks
 * Every `ORDER BY`, `<` and `lower()` of the repositories follows the locale of
 * the database, and the default of a cluster is the locale of its system. Text
 * sorted under `de_DE` would change the order of lists without any error, so
 * the database is checked once here instead of in each statement.
 */
export async function requireByteOrderedDatabase(
  engine: DatabaseEngine,
): Promise<void> {
  const [row] = await engine.read(READ_DATABASE_LOCALE, {});
  if (
    !row ||
    readTextColumn(row, 0, "encoding") !== "UTF8" ||
    readTextColumn(row, 1, "provider") !== LIBC_PROVIDER ||
    !BYTE_ORDER_COLLATIONS.has(readTextColumn(row, 2, "collation")) ||
    !UNICODE_CHARACTER_TYPES.has(readTextColumn(row, 3, "character_type"))
  )
    throw new PostgresLocaleError();
}
