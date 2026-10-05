import { existsSync } from "node:fs";
import path from "node:path";

const LEGACY_DATABASE_FILE_NAME = "pages.db";

/**
 * Builds the start-up warning for a SQLite database that was left behind.
 *
 * @param databasePath - DuckDB file Pages is about to use.
 * @returns A message, or `null` when nothing needs the user's attention.
 *
 * @remarks
 * Earlier Pages versions kept their data in a SQLite file named `pages.db`.
 * Pages never reads it, so setting up the DuckDB version would look like
 * data loss. The warning names the one-time transfer; it only appears while
 * the DuckDB file does not exist yet.
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

  return `[pages] Found the former SQLite database "${legacyPath}". Pages now uses DuckDB, which does not exist yet at "${databasePath}". To keep your data, stop Pages, run "pnpm db:transfer --source ${legacyPath} --target ${databasePath}" and start Pages again. The setup then opens the transferred database.`;
}
