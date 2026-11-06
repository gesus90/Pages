import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Migration } from "@/backend/database/Migration";

const DATABASE_DIRECTORY = fileURLToPath(
  new URL("../backend/database/", import.meta.url),
);

/**
 * Reads migrations without relying on the server's Vite build.
 *
 * @param directory - The directory below `backend/database/`.
 * @returns The migrations in name order.
 */
export async function readMigrations(
  directory: string,
): Promise<readonly Migration[]> {
  const root = path.join(DATABASE_DIRECTORY, directory);
  const names = (await readdir(root)).filter((name) => name.endsWith(".sql"));
  return Promise.all(
    names.sort().map(async (name) => ({
      name,
      sql: await readFile(path.join(root, name), "utf8"),
    })),
  );
}
