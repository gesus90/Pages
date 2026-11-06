import { execFile } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  processesNaming,
  runProgram,
} from "../postgres-check/temporary-instance";
import { RestoreCheckFailure } from "./restore-check-failure";

const runExecutable = promisify(execFile);

/** A finished base backup; `base-backup.sh` renames it to this only after its check. */
const BASE_BACKUP_NAME = /^\d{8}T\d{6}Z$/u;

/** The start of the name of a work directory of a check. */
export const WORK_DIRECTORY_PREFIX = "restore-check-";

const ARCHIVE_POLL_MS = 500;

/** Long enough for an archiver that retries, short of a full `archive_timeout`. */
const ARCHIVE_WAIT_MS = 120_000;

/** Where the backups of one instance lie, and the disk they must lie on. */
export interface BackupLocation {
  readonly rootDirectory: string;
  readonly baseDirectory: string;
  readonly walDirectory: string;
  readonly mountUuid: string;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads the location from the variables of `deploy/postgres/backup.env.example`.
 *
 * @param environment - The environment of the process.
 * @returns The location, or `null` when a variable is missing.
 */
export function readBackupLocation(
  environment: NodeJS.ProcessEnv,
): BackupLocation | null {
  const root = environment.PAGES_POSTGRES_BACKUP_ROOT;
  const mountUuid = environment.PAGES_POSTGRES_BACKUP_UUID;
  if (!root || !mountUuid) return null;
  const rootDirectory = path.resolve(root);
  return {
    rootDirectory,
    baseDirectory: path.join(rootDirectory, "base"),
    walDirectory: path.join(rootDirectory, "wal"),
    mountUuid,
  };
}

/**
 * Makes sure the backup directory lies on the expected file system.
 *
 * @param location - The location to check.
 * @throws {RestoreCheckFailure} When it lies on another one, for example because
 * the disk is not mounted and the path now belongs to the system disk.
 */
export async function requireBackupMount(
  location: BackupLocation,
): Promise<void> {
  let found = "";
  try {
    const { stdout } = await runExecutable("findmnt", [
      "--noheadings",
      "--output",
      "UUID",
      "--target",
      location.rootDirectory,
    ]);
    found = stdout.trim();
  } catch {
    throw new RestoreCheckFailure(
      "mount",
      `The file system of ${location.rootDirectory} cannot be determined.`,
    );
  }
  if (found !== location.mountUuid)
    throw new RestoreCheckFailure(
      "mount",
      `${location.rootDirectory} lies on the file system "${found}", not on ${location.mountUuid}.`,
    );
}

/**
 * Preserves earlier work directories and refuses to run beside a live check.
 *
 * @param location - The backup location to inspect.
 *
 * @throws {RestoreCheckFailure} When a process still uses such a directory.
 */
export async function removeLeftovers(location: BackupLocation): Promise<void> {
  const entries = await readdir(location.rootDirectory);
  for (const entry of entries) {
    if (!entry.startsWith(WORK_DIRECTORY_PREFIX)) continue;
    const directory = path.join(location.rootDirectory, entry);
    if ((await processesNaming(directory)).length > 0)
      throw new RestoreCheckFailure(
        "leftover",
        `A process still uses ${directory}: another check is running or left a server behind.`,
      );
  }
}

/**
 * Finds the newest finished base backup.
 *
 * @param location - The location to search.
 * @returns The directory of the backup.
 * @throws {RestoreCheckFailure} When there is none.
 */
export async function findNewestBaseBackup(
  location: BackupLocation,
): Promise<string> {
  const entries = (await pathExists(location.baseDirectory))
    ? await readdir(location.baseDirectory)
    : [];
  const newest = entries
    .filter((entry) => BASE_BACKUP_NAME.test(entry))
    .sort()
    .at(-1);
  if (newest === undefined)
    throw new RestoreCheckFailure(
      "base_backup",
      `${location.baseDirectory} holds no finished base backup.`,
    );
  return path.join(location.baseDirectory, newest);
}

/**
 * Compares a base backup with its manifest, including its WAL.
 *
 * @param directory - The directory of the backup, which stays unchanged.
 * @throws {RestoreCheckFailure} When a file is missing, added or changed.
 */
export async function verifyBaseBackup(directory: string): Promise<void> {
  try {
    await runProgram("pg_verifybackup", [directory]);
  } catch (error: unknown) {
    throw new RestoreCheckFailure(
      "verify",
      error instanceof Error ? error.message : "pg_verifybackup failed.",
    );
  }
}

/**
 * Waits until the archiver delivered a WAL file.
 *
 * @param location - The location of the archive.
 * @param fileName - The name of the WAL file.
 * @throws {RestoreCheckFailure} When it does not arrive in time.
 */
export async function waitForArchivedWal(
  location: BackupLocation,
  fileName: string,
): Promise<void> {
  const deadline = Date.now() + ARCHIVE_WAIT_MS;
  const target = path.join(location.walDirectory, fileName);
  while (!(await pathExists(target))) {
    if (Date.now() > deadline)
      throw new RestoreCheckFailure(
        "archive",
        `The WAL file ${fileName} did not reach the archive within ${String(ARCHIVE_WAIT_MS / 1000)} s. Check archive_command and pg_stat_archiver.`,
      );
    await new Promise((resolve) => setTimeout(resolve, ARCHIVE_POLL_MS));
  }
}
