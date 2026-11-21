import { writeFile } from "node:fs/promises";
import path from "node:path";

import type { SearchIndexRunReport } from "../../backend/service/search/SearchIndexService";
import type { BackupFigures } from "./backup-check";
import type { CheckResult } from "./check-support";
import type { ModeMeasurement, Rate } from "./search-measurement";

/** Everything one acceptance run found out. */
export interface AcceptanceReport {
  readonly runId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly modelVersion: string;
  readonly indexing: readonly SearchIndexRunReport[];
  readonly measurements: readonly ModeMeasurement[];
  readonly checks: readonly CheckResult[];
  readonly backup: BackupFigures | null;
  readonly isPassed: boolean;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)} %`;
}

function share(value: Rate): string {
  return `${String(value.hits)}/${String(value.total)} (${percent(value.rate)})`;
}

function measurementTable(measurements: readonly ModeMeasurement[]): string[] {
  const rows = [
    "| Mode | Top-5 hits | German | English | MRR | Precision@5 | p50 ms | p95 ms | max ms | Latency samples | Valid links |",
    "| ---- | ---------- | ------ | ------- | --- | ----------- | -----: | -----: | -----: | --------------: | ----------- |",
  ];
  for (const measurement of measurements) {
    const { latency, links } = measurement;
    rows.push(
      `| ${measurement.mode} | ${share(measurement.top5)} | ${measurement.byLanguage.de ? share(measurement.byLanguage.de) : "-"} | ${measurement.byLanguage.en ? share(measurement.byLanguage.en) : "-"} | ${measurement.meanReciprocalRank.toFixed(3)} | ${percent(measurement.precisionAt5)} | ${String(latency.p50)} | ${String(latency.p95)} | ${String(latency.max)} | ${String(latency.samples)} | ${String(links.valid)}/${String(links.checked)} |`,
    );
  }
  return rows;
}

function formTable(measurements: readonly ModeMeasurement[]): string[] {
  const forms = [
    ...new Set(
      measurements.flatMap((measurement) => Object.keys(measurement.byForm)),
    ),
  ];
  const rows = [
    `| Form | ${measurements.map((measurement) => measurement.mode).join(" | ")} |`,
    `| ---- | ${measurements.map(() => "---").join(" | ")} |`,
  ];
  for (const form of forms)
    rows.push(
      `| ${form} | ${measurements
        .map((measurement) => {
          const value = measurement.byForm[form];
          return value ? share(value) : "-";
        })
        .join(" | ")} |`,
    );
  return rows;
}

function questionTable(measurements: readonly ModeMeasurement[]): string[] {
  const rows = [
    `| Question | Language | Form | Expected | ${measurements.map((measurement) => `${measurement.mode} rank`).join(" | ")} |`,
    `| -------- | -------- | ---- | -------- | ${measurements.map(() => "---").join(" | ")} |`,
  ];
  const [first] = measurements;
  for (const [index, question] of (first?.questions ?? []).entries())
    rows.push(
      `| ${question.id} ${question.question} | ${question.language} | ${question.form} | ${question.expected.join(", ")} | ${measurements.map((measurement) => String(measurement.questions[index]?.hitRank ?? "–")).join(" | ")} |`,
    );
  return rows;
}

function checkTable(checks: readonly CheckResult[]): string[] {
  const rows = [
    "| Area | Expectation | Result |",
    "| ---- | ----------- | ------ |",
  ];
  for (const check of checks)
    rows.push(
      `| ${check.area} | ${check.name} | ${check.isPassed ? "passed" : "FAILED"} |`,
    );
  return rows;
}

/**
 * Renders the report as Markdown.
 * @param report - The finished run.
 * @returns Markdown with the measurements per mode, per form and per question, and every check.
 */
export function renderReport(report: AcceptanceReport): string {
  const failed = report.checks.filter((check) => !check.isPassed);
  return [
    `# RAG acceptance ${report.runId}`,
    "",
    `Started ${report.startedAt}, finished ${report.finishedAt}. Model version \`${report.modelVersion}\`. Result: **${report.isPassed ? "passed" : "failed"}** (${String(report.checks.length - failed.length)}/${String(report.checks.length)} checks).`,
    "",
    ...Object.entries(report.environment).map(
      ([key, value]) => `- ${key}: ${value}`,
    ),
    "",
    "## Search modes",
    "",
    ...measurementTable(report.measurements),
    "",
    ...formTable(report.measurements),
    "",
    ...questionTable(report.measurements),
    "",
    "## Checks",
    "",
    ...checkTable(report.checks),
    "",
    ...(failed.length === 0
      ? []
      : [
          "## Failed checks",
          "",
          ...failed.map((check) => `- ${check.name}: ${check.observed}`),
          "",
        ]),
    report.backup === null
      ? ""
      : `Backup: dump ${String(report.backup.dumpBytes)} bytes in ${report.backup.dumpMilliseconds.toFixed(0)} ms, restore with pgvector in ${report.backup.restoreMilliseconds.toFixed(0)} ms.`,
    "",
  ].join("\n");
}

/**
 * Writes the report as JSON and Markdown.
 * @param directory - Output directory of the run.
 * @param report - The finished run.
 * @returns The paths written.
 */
export async function writeReport(
  directory: string,
  report: AcceptanceReport,
): Promise<{ readonly json: string; readonly markdown: string }> {
  const json = path.join(directory, "rag-acceptance-report.json");
  const markdown = path.join(directory, "rag-acceptance-report.md");
  await writeFile(json, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await writeFile(markdown, renderReport(report), {
    encoding: "utf8",
    mode: 0o600,
  });
  return { json, markdown };
}
