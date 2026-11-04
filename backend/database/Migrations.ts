import type { DatabaseDialect } from "./DatabaseDialect";
import type { Migration } from "./Migration";

const migrationScripts = import.meta.glob<string>("./migrations/*.sql", {
  eager: true,
  import: "default",
  query: "?raw",
});

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

/**
 * Every DuckDB migration of Pages.
 *
 * @remarks
 * The scripts are embedded at build time, so the server finds them no matter
 * which directory it starts in and the build output stays self-contained.
 */
export const DATABASE_MIGRATIONS: readonly Migration[] =
  toMigrations(migrationScripts);

/** Every PostgreSQL migration of Pages, embedded like the DuckDB ones. */
export const POSTGRES_MIGRATIONS: readonly Migration[] = toMigrations(
  postgresMigrationScripts,
);

/**
 * Picks the migrations of the dialect the database speaks.
 *
 * @param dialect - The dialect of the open database, see `Database.dialect`.
 * @returns The migrations to hand to `Database.migrate`.
 */
export function migrationsFor(dialect: DatabaseDialect): readonly Migration[] {
  return dialect === "postgres" ? POSTGRES_MIGRATIONS : DATABASE_MIGRATIONS;
}
