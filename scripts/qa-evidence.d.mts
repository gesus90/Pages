/** A raw counter of one metric in a `coverage-summary.json`. */
export interface CoverageCounter {
  readonly covered: number;
  readonly total: number;
  readonly skipped?: number;
}

/** The sorted manifest of a scope and its SHA-256. */
export interface EvidenceManifest {
  readonly fingerprint: string;
  readonly manifest: string;
  readonly fileCount: number;
}

/** The verdict over the raw counters of one coverage scope. */
export interface CoverageVerdict {
  readonly totals: Readonly<Record<string, CoverageCounter>> | null;
  readonly gaps: readonly {
    readonly file: string;
    readonly uncovered: Readonly<Record<string, number>>;
  }[];
  readonly issues: readonly string[];
}

export function isInFingerprintScope(file: string, scope: string): boolean;

export function buildManifest(
  files: readonly string[],
  readHash: (file: string) => string | null,
  runtime: Readonly<Record<string, string>>,
): EvidenceManifest;

export function evaluateCoverage(summary: unknown): CoverageVerdict;

export function inspectDependencies(input: {
  readonly lockfile: string | null;
  readonly installedLockfile: string | null;
  readonly state: {
    readonly settings?: { readonly enableGlobalVirtualStore?: boolean };
  } | null;
}): readonly string[];

export function evaluateHandoff(
  text: string,
  report: "pages",
  currentFingerprint: string,
): readonly string[];

export function isSummaryStale(
  summaryTime: number,
  newestSourceTime: number,
): boolean;

export const COVERAGE_POPULATIONS: Readonly<
  Record<
    "backend" | "frontend",
    {
      readonly directory: string;
      readonly include: readonly string[];
      readonly exclude: readonly string[];
    }
  >
>;

export function populationIssues(
  summaryFiles: readonly string[],
  files: readonly string[],
  scope: "backend" | "frontend",
  root: string,
): readonly string[];

export function currentManifest(
  root: string,
  scope: "pages",
  listTracked?: (root: string) => readonly string[],
): EvidenceManifest;

export function handoffIssues(
  root: string,
  report: "pages",
  text: string,
  listTracked?: (root: string) => readonly string[],
): readonly string[];
