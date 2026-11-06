import path from "node:path";

import { Database } from "@/backend/database/Database";
import { postgresErrorCode } from "@/backend/database/postgres/PostgresConnection";
import { PostgresLocaleError } from "@/backend/database/postgres/PostgresLocale";

import { readMigrations } from "../read-database-migrations";
import { DuckDbSource } from "./duckdb-source";
import {
  copyTable,
  prepareTarget,
  readForeignKeys,
  readTargetColumns,
  readTargetRows,
  readTargetSequences,
  refuseTargetWithData,
  setTargetSequence,
} from "./postgres-target";
import { cleanRows } from "./nul-removal";
import { checksumRows } from "./table-checksum";
import { planTables } from "./table-plan";
import { printReport } from "./transfer-report";
import { TransferRefusal } from "./transfer-refusal";

import type { RemovedNulCounts } from "./nul-removal";
import type { SequenceOutcome, TableOutcome } from "./transfer-report";
import type { TablePlan } from "./table-plan";

const EXIT_SUCCESS = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;

const USAGE = [
  "Usage: pnpm run db:transfer -- --from <duckdb-file> --to <postgres-url> [--verify-only]",
  "",
  "Copies a stopped Pages DuckDB file, opened read-only, into a PostgreSQL database",
  "without business data and compares row count and checksum of every table.",
  "--verify-only compares without writing. See docs/PostgresMigration.md.",
].join("\n");

const POSTGRES_URL = /^postgres(?:ql)?:\/\//u;

/** SQLSTATE of a duplicate key, which the removal of U+0000 can cause. */
const POSTGRES_UNIQUE_VIOLATION = "23505";

/** What the check of the tables takes from the run and adds to it. */
interface TableCheck {
  readonly copyDurations: ReadonlyMap<string, number>;
  readonly removedNul: RemovedNulCounts;
}

interface TransferArguments {
  readonly from: string;
  readonly to: string;
  readonly isVerifyOnly: boolean;
}

/** `pnpm run` hands on the `--` of its own command line. */
function parseArguments(argv: readonly string[]): TransferArguments | null {
  const parts = argv.filter((part) => part !== "--");
  const isVerifyOnly = parts.includes("--verify-only");
  const pairs = parts.filter((part) => part !== "--verify-only");
  const fromIndex = pairs.indexOf("--from");
  const toIndex = pairs.indexOf("--to");
  const from = pairs[fromIndex + 1];
  const to = pairs[toIndex + 1];
  if (
    pairs.length !== 4 ||
    fromIndex === -1 ||
    toIndex === -1 ||
    from === undefined ||
    to === undefined ||
    !POSTGRES_URL.test(to)
  )
    return null;
  return { from: path.resolve(from), to, isVerifyOnly };
}

async function refuseOtherSchemaLevel(source: DuckDbSource): Promise<void> {
  const applied = await source.readAppliedMigrations();
  const known = (await readMigrations("migrations")).map(
    (migration) => migration.name,
  );
  const missing = known.filter((name) => !applied.includes(name));
  const unknown = applied.filter((name) => !known.includes(name));
  if (missing.length > 0 || unknown.length > 0)
    throw new TransferRefusal(
      `The DuckDB file is not on the schema of this version (missing: ${missing.join(", ") || "none"}; unknown: ${unknown.join(", ") || "none"}). Run this version on it once and stop it cleanly.`,
    );
}

async function planTransfer(
  source: DuckDbSource,
  database: Database,
): Promise<readonly TablePlan[]> {
  return planTables({
    sourceColumns: await source.readColumns(),
    targetColumns: await readTargetColumns(database),
    primaryKeys: await source.readPrimaryKeys(),
    foreignKeys: await readForeignKeys(database),
  });
}

async function copyTables(
  source: DuckDbSource,
  database: Database,
  plans: readonly TablePlan[],
): Promise<ReadonlyMap<string, number>> {
  const durations = new Map<string, number>();
  for (const plan of plans) {
    const startedAt = performance.now();
    try {
      await copyTable(database, plan, cleanRows(plan, source.readRows(plan)));
    } catch (error: unknown) {
      throw new TransferRefusal(describeCopyFailure(plan.name, error));
    }
    durations.set(plan.name, performance.now() - startedAt);
    console.info(`copied ${plan.name}`);
  }
  for (const [name, nextValue] of await source.readSequences())
    await setTargetSequence(database, name, nextValue);
  return durations;
}

async function checkTables(
  source: DuckDbSource,
  database: Database,
  plans: readonly TablePlan[],
  check: TableCheck,
): Promise<readonly TableOutcome[]> {
  const outcomes: TableOutcome[] = [];
  for (const plan of plans) {
    const startedAt = performance.now();
    const sourceSum = await checksumRows(
      cleanRows(plan, source.readRows(plan), check.removedNul),
    );
    const targetSum = await checksumRows(readTargetRows(database, plan));
    outcomes.push({
      table: plan.name,
      sourceRows: sourceSum.rows,
      targetRows: targetSum.rows,
      expectedChecksum: sourceSum.checksum,
      targetChecksum: targetSum.checksum,
      copyMs: check.copyDurations.get(plan.name) ?? null,
      checkMs: performance.now() - startedAt,
    });
  }
  return outcomes;
}

async function checkSequences(
  source: DuckDbSource,
  database: Database,
): Promise<readonly SequenceOutcome[]> {
  const sourceValues = await source.readSequences();
  const targetValues = await readTargetSequences(database);
  return [...new Set([...sourceValues.keys(), ...targetValues.keys()])]
    .sort()
    .map((sequence) => ({
      sequence,
      sourceNext: sourceValues.get(sequence) ?? null,
      targetNext: targetValues.get(sequence) ?? null,
    }));
}

async function transferBetween(
  source: DuckDbSource,
  database: Database,
  isVerifyOnly: boolean,
): Promise<number> {
  const startedAt = performance.now();
  await refuseOtherSchemaLevel(source);
  if (!isVerifyOnly)
    await prepareTarget(database, await readMigrations("postgres/migrations"));
  const plans = await planTransfer(source, database);
  let copyDurations: ReadonlyMap<string, number> = new Map();
  if (!isVerifyOnly) {
    await refuseTargetWithData(database, plans);
    copyDurations = await copyTables(source, database, plans);
  }
  const removedNul: RemovedNulCounts = new Map();
  return printReport({
    tables: await checkTables(source, database, plans, {
      copyDurations,
      removedNul,
    }),
    sequences: await checkSequences(source, database),
    removedNul: [...removedNul.values()],
    totalMs: performance.now() - startedAt,
    hasCopied: !isVerifyOnly,
  });
}

async function runTransfer(transfer: TransferArguments): Promise<number> {
  const source = await DuckDbSource.open(transfer.from);
  try {
    const database = await Database.connect(transfer.to);
    try {
      return await transferBetween(source, database, transfer.isVerifyOnly);
    } finally {
      await database.close();
    }
  } finally {
    source.close();
  }
}

/** Name and SQLSTATE only: the text of a driver error can quote a value or the URL. */
function describeError(error: unknown): string {
  const code = postgresErrorCode(error);
  const name = error instanceof Error ? error.name : "UnknownError";
  return code === null ? name : `${name}, code ${code}`;
}

function describeCopyFailure(table: string, error: unknown): string {
  const reason =
    error instanceof TransferRefusal
      ? error.message
      : `Copying table ${table} failed (${describeError(error)}).`;
  const hint =
    postgresErrorCode(error) === POSTGRES_UNIQUE_VIOLATION
      ? " Two keys can become equal once U+0000 is gone, see docs/PostgresMigration.md."
      : "";
  return `${reason}${hint} Earlier tables stay in the target: use a new database for the next attempt.`;
}

function describeFailure(error: unknown): string {
  return error instanceof TransferRefusal ||
    error instanceof PostgresLocaleError
    ? error.message
    : `The transfer failed (${describeError(error)}).`;
}

/**
 * Runs the transfer for command-line arguments.
 *
 * @param argv - Arguments after the script name.
 * @returns The exit code: 0 without a deviation, 1 on a deviation or failure, 2 on wrong usage.
 */
export async function runTransferCommand(
  argv: readonly string[],
): Promise<number> {
  const transfer = parseArguments(argv);
  if (transfer === null) {
    console.error(USAGE);
    return EXIT_USAGE;
  }
  try {
    return (await runTransfer(transfer)) === 0 ? EXIT_SUCCESS : EXIT_FAILED;
  } catch (error: unknown) {
    console.error(describeFailure(error));
    return EXIT_FAILED;
  }
}
