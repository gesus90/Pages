import path from "node:path";

import { ConfigFile } from "@/backend/config/ConfigFile";
import { resolveDefaultConfigPath } from "@/backend/config/PagesConfig";
import { Database } from "@/backend/database/Database";
import { postgresErrorCode } from "@/backend/database/postgres/PostgresConnection";
import {
  closeLogging,
  initializeLogging,
  logEvent,
} from "@/backend/logging/Logger";

import {
  findNewestBaseBackup,
  readBackupLocation,
  removeLeftovers,
  requireBackupMount,
  verifyBaseBackup,
  waitForArchivedWal,
} from "./backup-location";
import { RestoredInstance } from "./restored-instance";
import { RestoreCheckFailure } from "./restore-check-failure";
import { takeSourceCheckpoint } from "./source-checkpoint";
import { compareCounts, countRows, readTableNames } from "./table-counts";

import type { BackupLocation } from "./backup-location";
import type { RestoreCheckStep } from "./restore-check-failure";
import type { SourceCheckpoint } from "./source-checkpoint";
import type { TableCounts } from "./table-counts";

const EXIT_SUCCESS = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;
const EXIT_AFTER_SIGNAL = 130;

/**
 * A directory of its own: a running Pages holds the lock on its log directory, and
 * this command runs beside it.
 */
const LOG_HOME = "postgres-restore-check";

const LOG_COMPONENT = "PostgresRestoreCheck";

const POSTGRES_INSUFFICIENT_PRIVILEGE = "42501";

/** The metadata of a log event keeps at most this much of a text. */
const REASON_LENGTH = 256;

const USAGE = [
  "Usage: pnpm run postgres:restore-check [-- --config <config.toml>]",
  "",
  "Restores the newest base backup into a throwaway instance, replays the WAL archive",
  "to a point in time and compares tables and row counts with the source. It needs the",
  "variables PAGES_POSTGRES_BACKUP_ROOT and PAGES_POSTGRES_BACKUP_UUID, and databaseUrl",
  "in the configuration. See docs/PostgresMigration.md.",
].join("\n");

const READ_MARKER = `
  SELECT id
  FROM pages_restore_check.markers
  WHERE id = $id;
`;

/** What one passed run found. */
interface CheckResult {
  readonly baseBackup: string;
  readonly targetTime: string;
  readonly counts: TableCounts;
}

function parseConfigPath(argv: readonly string[]): string | null {
  const parts = argv.filter((part) => part !== "--");
  if (parts.length === 0) return resolveDefaultConfigPath();
  const configPath = parts[1];
  if (parts.length !== 2 || parts[0] !== "--config" || configPath === undefined)
    return null;
  return path.resolve(configPath);
}

async function readSourceUrl(configPath: string): Promise<string> {
  const config = await new ConfigFile(configPath).read();
  const url =
    config === null || config.firstRun ? undefined : config.databaseUrl;
  if (url === undefined)
    throw new RestoreCheckFailure(
      "source",
      `${configPath} names no PostgreSQL database (databaseUrl).`,
    );
  return url;
}

/** Name and SQLSTATE only: the text of a driver error can quote a value or the URL. */
function describeCause(error: unknown, code: string | null): string {
  if (code === POSTGRES_INSUFFICIENT_PRIVILEGE)
    return `PostgreSQL refused a statement for lack of a right, code ${code}. See the rights in docs/PostgresMigration.md.`;
  if (code !== null) return `PostgreSQL refused a statement, code ${code}.`;
  return error instanceof Error ? error.name : "UnknownError";
}

async function inStep<Result>(
  step: RestoreCheckStep,
  work: () => Promise<Result>,
): Promise<Result> {
  try {
    return await work();
  } catch (error: unknown) {
    if (error instanceof RestoreCheckFailure) throw error;
    const code = postgresErrorCode(error);
    throw new RestoreCheckFailure(step, describeCause(error, code), code);
  }
}

async function hasMarker(database: Database, id: string): Promise<boolean> {
  return (await database.query(READ_MARKER, { id })).length > 0;
}

/** Compares the recovered instance with what the source held at the point in time. */
async function compareRestored(
  restoredUrl: string,
  checkpoint: SourceCheckpoint,
): Promise<void> {
  const database = await Database.connect(restoredUrl);
  try {
    const counts = await countRows(database, await readTableNames(database));
    const deviations = [...compareCounts(checkpoint.counts, counts)];
    if (!(await hasMarker(database, checkpoint.confirmedMarker)))
      deviations.push("The row confirmed before the point in time is missing");
    if (await hasMarker(database, checkpoint.laterMarker))
      deviations.push("The row confirmed after the point in time is present");
    if (deviations.length > 0)
      throw new RestoreCheckFailure(
        "comparison",
        `The restored data differs: ${deviations.join("; ")}.`,
      );
  } finally {
    await database.close();
  }
}

/** A signal must not leave a server with real data behind. */
function removeOnSignal(instance: RestoredInstance): () => void {
  const removeAfterSignal = (): void => {
    void instance.remove().finally(() => process.exit(EXIT_AFTER_SIGNAL));
  };
  process.once("SIGINT", removeAfterSignal);
  process.once("SIGTERM", removeAfterSignal);
  return () => {
    process.off("SIGINT", removeAfterSignal);
    process.off("SIGTERM", removeAfterSignal);
  };
}

async function restoreAndCompare(
  baseBackup: string,
  location: BackupLocation,
  checkpoint: SourceCheckpoint,
  sourceUrl: string,
): Promise<void> {
  const instance = await inStep("restore", () =>
    RestoredInstance.prepare(location.rootDirectory),
  );
  const forgetSignals = removeOnSignal(instance);
  try {
    await inStep("restore", () =>
      instance.copyFrom(baseBackup, {
        walDirectory: location.walDirectory,
        targetTime: checkpoint.targetTime,
      }),
    );
    await inStep("recovery", () => instance.recover());
    await inStep("comparison", () =>
      compareRestored(instance.urlFor(sourceUrl), checkpoint),
    );
  } finally {
    forgetSignals();
    await inStep("cleanup", () => instance.remove());
  }
}

async function runCheck(
  location: BackupLocation,
  configPath: string,
): Promise<CheckResult> {
  await requireBackupMount(location);
  await inStep("leftover", () => removeLeftovers(location));
  const baseBackup = await inStep("base_backup", () =>
    findNewestBaseBackup(location),
  );
  // Before the source: a broken backup needs neither a marker nor a moment of lock.
  await verifyBaseBackup(baseBackup);
  const sourceUrl = await inStep("source", () => readSourceUrl(configPath));
  const checkpoint = await inStep("source", () =>
    takeSourceCheckpoint(sourceUrl),
  );
  await inStep("archive", () =>
    waitForArchivedWal(location, checkpoint.walFile),
  );
  await restoreAndCompare(baseBackup, location, checkpoint, sourceUrl);
  return {
    baseBackup: path.basename(baseBackup),
    targetTime: checkpoint.targetTime,
    counts: checkpoint.counts,
  };
}

function sumRows(counts: TableCounts): bigint {
  return [...counts.values()].reduce((sum, rows) => sum + rows, 0n);
}

function reportPassed(result: CheckResult, durationMs: number): void {
  const rows = sumRows(result.counts);
  for (const [table, count] of result.counts)
    console.info(`${table.padEnd(44)} ${String(count).padStart(9)}`);
  const message = `Base backup ${result.baseBackup} restored to ${result.targetTime}: ${String(result.counts.size)} tables and ${String(rows)} rows as at the source, the row confirmed before that time is present, the later one is not.`;
  console.info(message);
  logEvent({
    level: "info",
    event: "postgres.restore_check.passed",
    component: LOG_COMPONENT,
    message,
    metadata: {
      status: "passed",
      source: result.baseBackup,
      count: result.counts.size,
      rows: Number(rows),
      durationMs,
    },
  });
}

function reportFailed(failure: RestoreCheckFailure, durationMs: number): void {
  console.error(
    `postgres:restore-check failed (${failure.step}): ${failure.message}`,
  );
  logEvent({
    level: "error",
    event: "postgres.restore_check.failed",
    component: LOG_COMPONENT,
    message: `The restore check failed in step ${failure.step}`,
    metadata: {
      status: "failed",
      step: failure.step,
      code: failure.code,
      reason: failure.message.slice(0, REASON_LENGTH),
      durationMs,
    },
  });
}

async function runAndReport(
  location: BackupLocation,
  configPath: string,
): Promise<number> {
  const startedAt = performance.now();
  try {
    const result = await runCheck(location, configPath);
    reportPassed(result, Math.round(performance.now() - startedAt));
    return EXIT_SUCCESS;
  } catch (error: unknown) {
    const failure =
      error instanceof RestoreCheckFailure
        ? error
        : new RestoreCheckFailure(
            "source",
            error instanceof Error ? error.name : "UnknownError",
          );
    reportFailed(failure, Math.round(performance.now() - startedAt));
    return EXIT_FAILED;
  }
}

/**
 * Runs the check for command-line arguments.
 *
 * @param argv - Arguments after the script name.
 * @returns The exit code: 0 when the check passed, 1 when it failed, 2 on wrong usage.
 */
export async function runRestoreCheckCommand(
  argv: readonly string[],
): Promise<number> {
  const configPath = parseConfigPath(argv);
  const location = readBackupLocation(process.env);
  if (configPath === null || location === null) {
    console.error(USAGE);
    return EXIT_USAGE;
  }
  await initializeLogging(
    path.join(path.dirname(configPath), LOG_HOME, "config.toml"),
  );
  try {
    return await runAndReport(location, configPath);
  } finally {
    await closeLogging();
  }
}
