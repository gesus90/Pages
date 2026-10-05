import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { Migration } from "./Migration";

/**
 * Reads the migration scripts of a directory.
 *
 * @param directory - Directory holding `*.sql` files.
 * @returns The scripts in file-name order.
 *
 * @remarks
 * The server embeds its migrations at build time (see `Migrations.ts`).
 * Command-line tools run without the bundler and read the same files here.
 */
export async function readMigrationFiles(
  directory: string,
): Promise<Migration[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const fileNames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();

  return Promise.all(
    fileNames.map(async (name) => ({
      name,
      sql: await readFile(path.join(directory, name), "utf8"),
    })),
  );
}
