import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { pagesTempDirectory } from "../../backend/config/PagesTempDirectory";
import { readMigrations } from "../read-database-migrations";

import { runDatabaseChecks } from "./database-checks";
import {
  IntegrationCluster,
  POSTGRES_MAJOR_VERSION,
} from "./integration-cluster";
import {
  describeReport,
  EXIT_CODES,
  writeIntegrationReport,
} from "./integration-report";
import { runMigrationChecks, UPGRADE_BASE_MIGRATION } from "./migration-checks";

import type { CheckResult, IntegrationContext } from "./check-support";
import type { IntegrationReport } from "./integration-report";

const USAGE = `Usage: pnpm run test:integration [--output <directory>]
  Starts a throwaway PostgreSQL ${String(POSTGRES_MAJOR_VERSION)} server, runs the migration and database checks and removes the server.
  Exit code: 0 all checks passed, 1 a check failed, 2 setup or cleanup failed, 3 interrupted, 64 wrong usage.
  The report is written to <directory>/integration-report.json and .tsv (default coverage/postgres-integration).`;

const DEFAULT_OUTPUT_DIRECTORY = "coverage/postgres-integration";

const USAGE_EXIT_CODE = 64;

/** What the checks left behind and what the run needs to report. */
interface RunOutcome {
  readonly postgresVersion: string;
  readonly migrationCount: number;
  readonly checks: readonly CheckResult[];
  readonly problems: readonly string[];
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runChecks(
  cluster: IntegrationCluster,
  problems: string[],
): Promise<RunOutcome> {
  await cluster.start();
  const version = await cluster.serverVersion();
  if (Math.floor(version.number / 10_000) !== POSTGRES_MAJOR_VERSION) {
    problems.push(
      `The suite needs PostgreSQL ${String(POSTGRES_MAJOR_VERSION)}, the server is ${version.text}.`,
    );
    return {
      postgresVersion: version.text,
      migrationCount: 0,
      checks: [],
      problems,
    };
  }
  const migrations = await readMigrations("postgres/migrations");
  const context: IntegrationContext = {
    migrations,
    createDatabase: (name) => cluster.createDatabase(name),
  };
  return {
    postgresVersion: version.text,
    migrationCount: migrations.length,
    checks: [
      ...(await runMigrationChecks(context)),
      ...(await runDatabaseChecks(context)),
    ],
    problems,
  };
}

function exitCodeOf(outcome: RunOutcome): number {
  if (outcome.problems.length > 0) return EXIT_CODES.setupOrCleanupFailed;
  if (outcome.checks.length === 0) return EXIT_CODES.setupOrCleanupFailed;
  return outcome.checks.every((check) => check.status === "passed")
    ? EXIT_CODES.passed
    : EXIT_CODES.checkFailed;
}

/** The output directory, or the exit code that ends the command at once. */
type ParsedArguments =
  { readonly output: string } | { readonly exitCode: number };

function parseArguments(argv: readonly string[]): ParsedArguments {
  try {
    const { values } = parseArgs({
      args: [...argv],
      options: { output: { type: "string" }, help: { type: "boolean" } },
    });
    if (values.help) {
      process.stdout.write(`${USAGE}\n`);
      return { exitCode: EXIT_CODES.passed };
    }
    return { output: path.resolve(values.output ?? DEFAULT_OUTPUT_DIRECTORY) };
  } catch (error: unknown) {
    process.stderr.write(`${describeError(error)}\n${USAGE}\n`);
    return { exitCode: USAGE_EXIT_CODE };
  }
}

/** Starts the checks on a prepared cluster, and always removes the cluster again. */
async function runAndClean(
  cluster: IntegrationCluster | null,
  serverLog: string,
  problems: string[],
): Promise<RunOutcome> {
  let outcome: RunOutcome = {
    postgresVersion: "",
    migrationCount: 0,
    checks: [],
    problems,
  };
  try {
    if (cluster !== null) outcome = await runChecks(cluster, problems);
  } catch (error: unknown) {
    problems.push(`The run stopped: ${describeError(error)}`);
  } finally {
    await cluster?.remove(serverLog).catch((error: unknown) => {
      problems.push(`The cleanup failed: ${describeError(error)}`);
    });
  }
  return outcome;
}

/**
 * Runs the suite once: a throwaway server, the checks, the cleanup and the report.
 * @param argv - The arguments after the command name.
 * @returns The exit code of the command.
 */
export async function runIntegrationCommand(
  argv: readonly string[],
): Promise<number> {
  const parsed = parseArguments(argv);
  if ("exitCode" in parsed) return parsed.exitCode;
  const output = parsed.output;
  await mkdir(output, { recursive: true });
  const startedAt = new Date().toISOString();
  const problems: string[] = [];
  const cluster = await IntegrationCluster.prepare(
    pagesTempDirectory("postgres-integration"),
  ).catch((error: unknown) => {
    problems.push(
      `The run directory could not be prepared: ${describeError(error)}`,
    );
    return null;
  });
  const serverLog = path.join(output, "postgres-server.log");
  let isInterrupted = false;
  const onSignal = (): void => {
    isInterrupted = true;
    void cluster
      ?.remove(serverLog)
      .finally(() => process.exit(EXIT_CODES.interrupted));
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  const outcome = await runAndClean(cluster, serverLog, problems);
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);
  const exitCode = isInterrupted
    ? EXIT_CODES.interrupted
    : exitCodeOf({ ...outcome, problems });
  const report: IntegrationReport = {
    runId: randomBytes(6).toString("hex"),
    startedAt,
    finishedAt: new Date().toISOString(),
    postgresVersion: outcome.postgresVersion,
    requiredMajorVersion: POSTGRES_MAJOR_VERSION,
    upgradeBaseMigration: UPGRADE_BASE_MIGRATION,
    migrationCount: outcome.migrationCount,
    exitCode,
    problems,
    checks: outcome.checks,
  };
  await writeIntegrationReport(output, report);
  process.stdout.write(describeReport(report));
  return exitCode;
}
