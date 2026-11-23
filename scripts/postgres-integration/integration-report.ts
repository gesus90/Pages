import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { CheckResult } from "./check-support";

/** Where the run ended, as the exit code of the command. */
export const EXIT_CODES = {
  passed: 0,
  checkFailed: 1,
  setupOrCleanupFailed: 2,
  interrupted: 3,
} as const;

/** The evidence of one run, written as JSON and as a table. */
export interface IntegrationReport {
  readonly runId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  /** The version text the server reported; empty when it never started. */
  readonly postgresVersion: string;
  readonly requiredMajorVersion: number;
  readonly upgradeBaseMigration: string;
  readonly migrationCount: number;
  readonly exitCode: number;
  /** Why the run could not run its checks or clean up; empty otherwise. */
  readonly problems: readonly string[];
  readonly checks: readonly CheckResult[];
}

function tabSeparated(report: IntegrationReport): string {
  const lines = report.checks.map((check) =>
    [
      check.name,
      check.status,
      String(check.milliseconds),
      check.detail.replaceAll(/\s+/gu, " "),
    ].join("\t"),
  );
  return `${["check\tstatus\tmilliseconds\tdetail", ...lines].join("\n")}\n`;
}

/**
 * Writes `integration-report.json` and `integration-report.tsv`.
 * @param directory - The output directory; it is created when it is missing.
 * @param report - The evidence of the run.
 */
export async function writeIntegrationReport(
  directory: string,
  report: IntegrationReport,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "integration-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await writeFile(
    path.join(directory, "integration-report.tsv"),
    tabSeparated(report),
  );
}

/**
 * Formats the result for the terminal and the job summary.
 * @param report - The evidence of the run.
 * @returns One line per check and the totals.
 */
export function describeReport(report: IntegrationReport): string {
  const lines = report.checks.map(
    (check) =>
      `${check.status === "passed" ? "PASS" : "FAIL"}  ${check.name} (${String(check.milliseconds)} ms) - ${check.detail}`,
  );
  const failed = report.checks.filter(
    (check) => check.status === "failed",
  ).length;
  return [
    `PostgreSQL: ${report.postgresVersion || "not started"}`,
    ...lines,
    ...report.problems.map((problem) => `PROBLEM  ${problem}`),
    `${String(report.checks.length - failed)} of ${String(report.checks.length)} checks passed, exit code ${String(report.exitCode)}`,
    "",
  ].join("\n");
}
