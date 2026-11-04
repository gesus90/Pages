/** SQL dialects the database facade can run. */
export type DatabaseDialect = "duckdb" | "postgres";

/** One statement, written once per dialect. */
export interface DialectSql {
  readonly duckdb: string;
  readonly postgres: string;
}

/**
 * Picks the statement of the dialect the database speaks.
 *
 * @param dialect - The dialect of the open database, see `Database.dialect`.
 * @param variants - The statement per dialect.
 * @returns The statement to run.
 *
 * @remarks
 * Only for SQL that cannot be the same in both dialects; shared SQL comes first.
 */
export function sqlForDialect(
  dialect: DatabaseDialect,
  variants: DialectSql,
): string {
  return variants[dialect];
}
