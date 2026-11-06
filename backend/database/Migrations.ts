import type { Migration } from "./Migration";

const postgresMigrationScripts = import.meta.glob<string>(
  "./postgres/migrations/*.sql",
  {
    eager: true,
    import: "default",
    query: "?raw",
  },
);

function toMigrations(scripts: Record<string, string>): readonly Migration[] {
  return Object.entries(scripts).map(([scriptPath, sql]) => ({
    name: scriptPath.slice(scriptPath.lastIndexOf("/") + 1),
    sql,
  }));
}

/** Every PostgreSQL migration of Pages, embedded like the DuckDB ones. */
export const POSTGRES_MIGRATIONS: readonly Migration[] = toMigrations(
  postgresMigrationScripts,
);
