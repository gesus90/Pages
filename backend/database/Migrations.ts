import type { Migration } from "./Migration";

const migrationScripts = import.meta.glob<string>("./migrations-duckdb/*.sql", {
  eager: true,
  import: "default",
  query: "?raw",
});

/**
 * Every DuckDB migration of Pages.
 *
 * @remarks
 * The scripts are embedded at build time, so the server finds them no matter
 * which directory it starts in and the build output stays self-contained.
 */
export const DATABASE_MIGRATIONS: readonly Migration[] = Object.entries(
  migrationScripts,
).map(([scriptPath, sql]) => ({
  name: scriptPath.slice(scriptPath.lastIndexOf("/") + 1),
  sql,
}));
