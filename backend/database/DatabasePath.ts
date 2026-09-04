import { homedir } from "node:os";
import path from "node:path";

const PAGES_DIRECTORY_NAME = ".pages";
const DATA_DIRECTORY_NAME = "data";
const DATABASE_FILE_NAME = "pages.duckdb";

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
