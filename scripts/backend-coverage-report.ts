import { globSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { z } from "zod";

import {
  BACKEND_COVERAGE_EXCLUDES,
  BACKEND_COVERAGE_SECTIONS,
} from "../vitest.backend.config";

type BackendCoverageSection =
  (typeof BACKEND_COVERAGE_SECTIONS)[number]["name"];

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

type ModuleCoverage = z.infer<typeof summarySchema>[string];

/** One source module, including modules absent from the provider's report. */
export interface BackendCoverageEntry {
  readonly file: string;
  readonly section: BackendCoverageSection;
  readonly status: "covered" | "open" | "not-applicable" | "missing";
  readonly metrics: ModuleCoverage | null;
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

function isTypeOnlyModule(file: string): boolean {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
  );
  return source.statements.every(isTypeOnlyStatement);
}

function sectionForFile(file: string): BackendCoverageEntry["section"] {
  const section = BACKEND_COVERAGE_SECTIONS.find((entry) =>
    path.matchesGlob(file, entry.include),
  );
  if (!section) throw new Error(`Source outside coverage scope: ${file}`);
  return section.name;
}

function moduleStatus(
  file: string,
  metrics: ModuleCoverage | undefined,
): BackendCoverageEntry["status"] {
  if (isTypeOnlyModule(file)) return "not-applicable";
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
    const section = sectionForFile(file);
    return {
      file,
      section,
      status: moduleStatus(absolutePath, metrics),
      metrics: metrics ?? null,
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
      if (!metric || metric.total === 0) return "n/a";
      return `${metric.pct}% (${metric.covered}/${metric.total})`;
    });
    return [entry.file, entry.status, ...percentages].join("\t");
  });
  return [
    "File\tStatus\tStatements\tBranches\tFunctions\tLines",
    ...rows,
    "",
  ].join("\n");
}

/** Reads the generated coverage artifacts and writes separate complete scope inventories. */
export function writeBackendCoverageInventory(root: string): void {
  const directory = path.join(root, "coverage/backend");
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
      `[backend coverage] ${section}: ${selected.length} modules, ${selected.filter((entry) => entry.status === "open").length} open; coverage/backend/${section}.tsv`,
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
