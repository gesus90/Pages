import { constants } from "node:fs";
import { access, lstat, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { inspectPagesDatabase } from "@/backend/database/PagesDatabaseInspector";
import {
  DATABASE_LOCATION_STATUS,
  MAXIMUM_DATABASE_PATH_LENGTH,
} from "@/definition/Setup";

import type { Stats } from "node:fs";
import type { DatabaseLocationStatus } from "@/definition/Setup";

const DATABASE_EXTENSION = ".duckdb";
const HOME_PREFIX = "~/";

/** The outcome of checking a database path. */
export interface DatabaseLocationCheck {
  readonly status: DatabaseLocationStatus;
  /** The normalized absolute path, or `null` when the input is no path. */
  readonly databasePath: string | null;
}

/**
 * Turns an entered database path into the absolute path Pages would use.
 *
 * @param input - Path as entered, already trimmed and not empty.
 * @returns The normalized path, or `null` when the input is no absolute
 * path (or `~/…`) of a `.duckdb` file.
 */
export function normalizeDatabasePath(input: string): string | null {
  if (input.length > MAXIMUM_DATABASE_PATH_LENGTH || input.includes("\0")) {
    return null;
  }

  const expanded = input.startsWith(HOME_PREFIX)
    ? path.join(homedir(), input.slice(HOME_PREFIX.length))
    : input;

  if (!path.isAbsolute(expanded) || /[\\/]$/u.test(expanded)) {
    return null;
  }

  const normalized = path.resolve(expanded);

  // `extname` is empty for a bare `.duckdb`, so a file name is required too.
  return path.extname(normalized).toLowerCase() === DATABASE_EXTENSION
    ? normalized
    : null;
}

async function isAccessible(target: string, mode: number): Promise<boolean> {
  try {
    await access(target, mode);

    return true;
  } catch {
    return false;
  }
}

async function readStats(
  target: string,
  read: (target: string) => Promise<Stats>,
): Promise<Stats | null> {
  try {
    return await read(target);
  } catch {
    return null;
  }
}

async function isWritableDirectory(directory: string): Promise<boolean> {
  const stats = await readStats(directory, stat);

  return (
    stats !== null &&
    stats.isDirectory() &&
    (await isAccessible(directory, constants.W_OK | constants.X_OK))
  );
}

async function checkExistingFile(
  databasePath: string,
  entry: Stats,
): Promise<DatabaseLocationStatus> {
  const target = entry.isSymbolicLink()
    ? await readStats(databasePath, stat)
    : entry;

  if (target === null || !target.isFile()) {
    return DATABASE_LOCATION_STATUS.FOREIGN;
  }

  if (!(await isAccessible(databasePath, constants.R_OK | constants.W_OK))) {
    return DATABASE_LOCATION_STATUS.NOT_WRITABLE;
  }

  const inspection = await inspectPagesDatabase(databasePath);

  if (inspection.kind === "pages") {
    return DATABASE_LOCATION_STATUS.EXISTING;
  }

  return inspection.kind === "locked"
    ? DATABASE_LOCATION_STATUS.NOT_WRITABLE
    : DATABASE_LOCATION_STATUS.FOREIGN;
}

/**
 * Checks whether the setup can use a database path.
 *
 * @param input - Path as entered in the wizard.
 * @returns The status and the normalized path it applies to.
 *
 * @remarks
 * The checks run in a fixed order: empty, format, writable directory,
 * then what already lies at the path. Nothing is created or changed; an
 * existing file is only opened read-only.
 */
export async function checkDatabaseLocation(
  input: string,
): Promise<DatabaseLocationCheck> {
  const trimmed = input.trim();

  if (trimmed === "") {
    return { databasePath: null, status: DATABASE_LOCATION_STATUS.EMPTY };
  }

  const databasePath = normalizeDatabasePath(trimmed);

  if (databasePath === null) {
    return { databasePath: null, status: DATABASE_LOCATION_STATUS.INVALID };
  }

  if (!(await isWritableDirectory(path.dirname(databasePath)))) {
    return { databasePath, status: DATABASE_LOCATION_STATUS.NOT_WRITABLE };
  }

  const entry = await readStats(databasePath, lstat);
  const status =
    entry === null
      ? DATABASE_LOCATION_STATUS.AVAILABLE
      : await checkExistingFile(databasePath, entry);

  return { databasePath, status };
}
