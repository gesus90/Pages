import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const PAGES_DIRECTORY_NAME = ".pages";
const DATA_DIRECTORY_NAME = "data";
const DATABASE_FILE_NAME = "pages.duckdb";
const LEGACY_DATABASE_FILE_NAME = "pages.db";

/**
 * Resolves the DuckDB file Pages should use.
 *
 * @returns The configured database path, defaulting to the Pages data
 * directory inside the current user's home directory.
 * @throws When the home directory cannot be determined.
 */
export function resolveDatabasePath(): string {
  const configuredPath = process.env.PAGES_DATABASE_PATH;

  if (configuredPath) {
    return path.resolve(configuredPath);
  }

  const homeDirectory = homedir();

  if (!homeDirectory) {
    throw new Error(
      "Pages could not determine the home directory of the current user.",
    );
  }

  return path.join(
    homeDirectory,
    PAGES_DIRECTORY_NAME,
    DATA_DIRECTORY_NAME,
    DATABASE_FILE_NAME,
  );
}

/**
 * Builds the start-up warning for a SQLite database that was left behind.
 *
 * @param databasePath - DuckDB file Pages is about to open.
 * @returns A message, or `null` when nothing needs the user's attention.
 *
 * @remarks
 * Earlier Pages versions kept their data in a SQLite file named `pages.db`.
 * Pages never reads it, so the first start of the DuckDB version would look
 * like data loss. The warning names the one-time transfer; it only appears
 * while the DuckDB file does not exist yet.
 */
export function createLegacyDatabaseWarning(
  databasePath: string,
): string | null {
  const legacyPath = path.join(
    path.dirname(databasePath),
    LEGACY_DATABASE_FILE_NAME,
  );

  if (existsSync(databasePath) || !existsSync(legacyPath)) {
    return null;
  }

  return `[pages] Found the former SQLite database "${legacyPath}". Pages now uses DuckDB and starts with an empty database at "${databasePath}". To keep your data, stop Pages, remove the new database file, run "pnpm db:transfer --source ${legacyPath} --target ${databasePath}" and start Pages again.`;
}
