import { globSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { z } from "zod";

import {
  BACKEND_COVERAGE_EXCLUDES,
  BACKEND_COVERAGE_SECTIONS,
  BACKEND_REPORTS_DIRECTORY,
  BACKEND_TEST_RESULTS_FILE,
  BACKEND_TEST_SECTIONS,
} from "../vitest.backend.config";

const METRIC_NAMES = ["statements", "branches", "functions", "lines"] as const;
const metricSchema = z.object({
  total: z.number().int().nonnegative(),
  covered: z.number().int().nonnegative(),
  pct: z.union([z.number(), z.literal("Unknown")]),
});
const summarySchema = z.record(
  z.string(),
  z.object({
    statements: metricSchema,
    branches: metricSchema,
    functions: metricSchema,
    lines: metricSchema,
  }),
);
const testResultsSchema = z.object({
  testResults: z.array(
    z.object({
      name: z.string(),
      assertionResults: z.array(
        z.object({
          status: z.enum(["passed", "failed", "skipped", "todo", "pending"]),
        }),
      ),
    }),
  ),
});

type BackendCoverageSection =
  (typeof BACKEND_COVERAGE_SECTIONS)[number]["name"];
type ModuleCoverage = z.infer<typeof summarySchema>[string];

interface BackendSectionTestCounts {
  readonly section: BackendCoverageSection;
  files: number;
  total: number;
  passed: number;
  failed: number;
  notRun: number;
}

/** One source module, including modules absent from the provider's report. */
export interface BackendCoverageEntry {
  readonly file: string;
  readonly section: BackendCoverageSection;
  readonly status: "covered" | "open" | "not-applicable" | "missing";
  readonly metrics: ModuleCoverage | null;
  readonly reason?: string;
}

function isTypeOnlyStatement(statement: ts.Statement): boolean {
  if (
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEmptyStatement(statement)
  ) {
    return true;
  }
  if (ts.isImportDeclaration(statement)) {
    return statement.importClause?.isTypeOnly === true;
  }
  if (ts.isExportDeclaration(statement)) {
    return (
      statement.isTypeOnly ||
      (statement.moduleSpecifier === undefined &&
        statement.exportClause !== undefined &&
        ts.isNamedExports(statement.exportClause) &&
        statement.exportClause.elements.length === 0)
    );
  }
  return false;
}

function declarationReason(file: string): string | undefined {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
  );
  if (source.statements.every(isTypeOnlyStatement)) {
    return "Type declarations only";
  }
  if (
    source.statements.every(
      (statement) =>
        isTypeOnlyStatement(statement) ||
        (ts.isExportDeclaration(statement) &&
          statement.moduleSpecifier !== undefined &&
          statement.exportClause !== undefined &&
          ts.isNamedExports(statement.exportClause)),
    )
  ) {
    return "Named re-exports with no implementation in this file";
  }
  return undefined;
}

function sectionForFile(
  file: string,
  sections: readonly { name: BackendCoverageSection; include: string }[],
): BackendCoverageSection {
  const section = sections.find((entry) =>
    path.matchesGlob(file, entry.include),
  );
  if (!section) throw new Error(`File outside the backend test scope: ${file}`);
  return section.name;
}

function moduleStatus(
  metrics: ModuleCoverage | undefined,
): BackendCoverageEntry["status"] {
  if (metrics) {
    if (METRIC_NAMES.every((name) => metrics[name].total === 0))
      return "missing";
    return METRIC_NAMES.every(
      (name) => metrics[name].covered === metrics[name].total,
    )
      ? "covered"
      : "open";
  }
  return "missing";
}

function writeBackendTestCounts(root: string, directory: string): void {
  const report: unknown = JSON.parse(
    readFileSync(path.join(directory, BACKEND_TEST_RESULTS_FILE), "utf8"),
  );
  const sections = countBackendTests(root, report);
  const table = [
    "Section\tFiles\tTests\tPassed\tFailed\tNot run",
    ...sections.map(({ section, files, total, passed, failed, notRun }) =>
      [section, files, total, passed, failed, notRun].join("\t"),
    ),
    "",
  ].join("\n");
  writeFileSync(path.join(directory, "section-tests.tsv"), table);
  writeFileSync(
    path.join(directory, "section-tests.json"),
    `${JSON.stringify(sections, null, 2)}\n`,
  );
  console.info("[backend tests] Test counts by section");
  console.info(table);
}

/** Counts collected Vitest cases by the section that selected their test file. */
export function countBackendTests(
  root: string,
  report: unknown,
): BackendSectionTestCounts[] {
  const { testResults } = testResultsSchema.parse(report);
  const counts = new Map<BackendCoverageSection, BackendSectionTestCounts>(
    BACKEND_TEST_SECTIONS.map(({ name }) => [
      name,
      { section: name, files: 0, total: 0, passed: 0, failed: 0, notRun: 0 },
    ]),
  );
  for (const { name, assertionResults } of testResults) {
    const file = path.relative(root, path.resolve(root, name));
    const section = sectionForFile(file, BACKEND_TEST_SECTIONS);
    const sectionCounts = counts.get(section);
    if (!sectionCounts) {
      throw new Error(`Unknown backend test section: ${section}`);
    }
    sectionCounts.files++;
    sectionCounts.total += assertionResults.length;
    for (const { status } of assertionResults) {
      if (status === "passed") sectionCounts.passed++;
      else if (status === "failed") sectionCounts.failed++;
      else sectionCounts.notRun++;
    }
  }
  return [...counts.values()];
}

/** Lists the full measurement scope without loading any application module. */
export function collectBackendCoverageSources(root: string): string[] {
  return globSync(
    BACKEND_COVERAGE_SECTIONS.map((section) => section.include),
    {
      cwd: root,
      exclude: BACKEND_COVERAGE_EXCLUDES,
    },
  )
    .map((file) => file.split(path.sep).join("/"))
    .sort();
}

/** Reconciles measured modules with the source scope and preserves every metric. */
export function buildBackendCoverageInventory(
  root: string,
  summary: unknown,
): BackendCoverageEntry[] {
  const parsedSummary = summarySchema.parse(summary);
  return collectBackendCoverageSources(root).map((file) => {
    const absolutePath = path.resolve(root, file);
    const metrics = parsedSummary[absolutePath];
    const section = sectionForFile(file, BACKEND_COVERAGE_SECTIONS);
    const reason = declarationReason(absolutePath);
    return {
      file,
      section,
      status: reason ? "not-applicable" : moduleStatus(metrics),
      metrics: metrics ?? null,
      ...(reason ? { reason } : {}),
    };
  });
}

/** Formats all four metrics, retaining absent measurements and zero-item metrics. */
export function formatBackendCoverageTable(
  entries: readonly BackendCoverageEntry[],
): string {
  const rows = entries.map((entry) => {
    const percentages = METRIC_NAMES.map((name) => {
      const metric = entry.metrics?.[name];
      if (entry.reason || !metric || metric.total === 0) return "n/a";
      return `${metric.pct}% (${metric.covered}/${metric.total})`;
    });
    return [entry.file, entry.status, ...percentages, entry.reason ?? ""].join(
      "\t",
    );
  });
  return [
    "File\tStatus\tStatements\tBranches\tFunctions\tLines\tReason",
    ...rows,
    "",
  ].join("\n");
}

/** Reads the generated coverage artifacts and writes separate complete scope inventories. */
export function writeBackendCoverageInventory(root: string): void {
  const directory = path.join(root, BACKEND_REPORTS_DIRECTORY);
  writeBackendTestCounts(root, directory);
  const summary: unknown = JSON.parse(
    readFileSync(path.join(directory, "coverage-summary.json"), "utf8"),
  );
  const entries = buildBackendCoverageInventory(root, summary);
  if (entries.length === 0) {
    throw new Error("The backend coverage source scope is empty.");
  }
  writeFileSync(
    path.join(directory, "scope-inventory.json"),
    `${JSON.stringify(entries, null, 2)}\n`,
  );
  const sections: readonly BackendCoverageSection[] = [
    ...BACKEND_COVERAGE_SECTIONS.map((section) => section.name),
  ];
  for (const section of sections) {
    const selected = entries.filter((entry) => entry.section === section);
    writeFileSync(
      path.join(directory, `${section}.tsv`),
      formatBackendCoverageTable(selected),
    );
    console.info(
      `[backend coverage] ${section}: ${selected.length} modules, ${selected.filter((entry) => entry.status === "open").length} open; ${BACKEND_REPORTS_DIRECTORY}/${section}.tsv`,
    );
  }
  const table = formatBackendCoverageTable(entries);
  writeFileSync(path.join(directory, "adopted-backend.tsv"), table);
  const missing = entries.filter((entry) => entry.status === "missing");
  if (missing.length > 0) {
    throw new Error(
      `Executable modules missing coverage measurements: ${missing.map((entry) => entry.file).join(", ")}`,
    );
  }
  const incomplete = entries.filter((entry) => entry.status === "open");
  if (incomplete.length > 0) {
    throw new Error(
      `Required modules below complete coverage: ${incomplete.map((entry) => entry.file).join(", ")}`,
    );
  }
  console.info("[backend coverage] Adopted modules (per-file thresholds)");
  console.info(table);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    writeBackendCoverageInventory(
      fileURLToPath(new URL("../", import.meta.url)),
    );
  } catch (error: unknown) {
    console.error(error);
    process.exitCode = 1;
  }
}
