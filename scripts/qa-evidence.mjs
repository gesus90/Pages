import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isFingerprintedFile, walkFiles } from "./source-population.mjs";

/** The four metrics that must be complete in every coverage scope. */
const METRICS = ["statements", "branches", "functions", "lines"];

/** Exit code of a command that was called in an unsupported way. */
const USAGE_EXIT_CODE = 2;

/** Files of a repository manifest that must never count as source. */
const TICKET_ASSET_PREFIX = ".pages-assets-";

/** The last report block, read exactly as Pages reads it for its acceptance. */
const REPORT_BLOCK = /```pages-report[^\n]*\n([\s\S]*?)\n```/gu;

/** The coverage scopes a QA report must name. */
const REPORT_COVERAGE_SCOPES = {
  pages: ["backend", "frontend"],
  mcp: ["mcp"],
};

/**
 * The production files of each coverage scope, as in its Vitest configuration.
 * A unit test compares the two, so a summary cannot shrink its own population.
 */
export const COVERAGE_POPULATIONS = {
  backend: {
    directory: ".",
    include: [
      "backend/**/*.ts",
      "scripts/runner/**/*.mjs",
      "app/**/*.server.{ts,tsx}",
      "app/lib/**/*.{ts,tsx}",
      "app/routes/**/*.{ts,tsx}",
      "app/root.tsx",
      "app/routes.ts",
      "definition/**/*.ts",
      "language/**/*.ts",
    ],
    exclude: [],
  },
  frontend: {
    directory: ".",
    include: [
      "app/components/**/*.{ts,tsx}",
      "app/lib/**/*.{ts,tsx}",
      "app/routes/**/*.tsx",
      "app/root.tsx",
      "app/routes.ts",
      "definition/**/*.ts",
      "language/**/*.ts",
    ],
    exclude: ["app/**/*.server.{ts,tsx}"],
  },
  mcp: {
    directory: "mcp",
    include: ["src/**/*.ts", "scripts/**/*.ts", "build.config.ts"],
    exclude: [],
  },
};

/** Package directories with their own lockfile and modules. */
const PACKAGES = { pages: ".", mcp: "mcp" };

/** What Pages runs of the MCP package: the shared tool catalog and its version. */
function isPagesMcpPath(file) {
  return file.startsWith("mcp/src/") || file === "mcp/package.json";
}

/**
 * Whether a repository path belongs to a fingerprint scope.
 *
 * @remarks
 * The two scopes overlap on purpose. Pages imports `mcp/src/`, so a change
 * there makes the evidence of both QA steps stale; a change of an MCP test
 * or script only the evidence of the MCP step.
 */
export function isInFingerprintScope(file, scope) {
  if (scope === "mcp") return file.startsWith("mcp/");
  if (file.startsWith("mobile/")) return false;
  return !file.startsWith("mcp/") || isPagesMcpPath(file);
}

/**
 * Builds the sorted manifest and its SHA-256.
 *
 * @param files - Repository-relative paths, in any order.
 * @param readHash - The SHA-256 of a file, or `null` for a deleted one.
 * @param runtime - Facts outside the files, such as the installed lockfile.
 */
export function buildManifest(files, readHash, runtime) {
  const sorted = [...new Set(files)]
    .filter((file) => !path.basename(file).startsWith(TICKET_ASSET_PREFIX))
    .sort();
  const lines = [
    ...sorted.map((file) => `${file}\0${readHash(file) ?? "DELETED"}`),
    ...Object.entries(runtime)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => `@${name}\0${value}`),
  ];
  const manifest = `${lines.join("\n")}\n`;
  return {
    fingerprint: createHash("sha256").update(manifest).digest("hex"),
    manifest,
    fileCount: sorted.length,
  };
}

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

/** What is wrong with one raw counter; `null` for a valid one. */
function counterIssue(counter) {
  if (counter === undefined || counter === null) return "missing";
  if (!isCount(counter.total) || !isCount(counter.covered)) return "invalid";
  if (counter.covered > counter.total) return "invalid";
  if (counter.skipped !== undefined && !isCount(counter.skipped)) {
    return "invalid";
  }
  return null;
}

function metricIssues(counter, metric, prefix) {
  const issue = counterIssue(counter);
  if (issue !== null) return [`${prefix}metric_${issue}:${metric}`];
  const issues = [];
  if (counter.covered !== counter.total) {
    issues.push(`${prefix}incomplete:${metric}`);
  }
  if ((counter.skipped ?? 0) !== 0) issues.push(`${prefix}skipped:${metric}`);
  return issues;
}

function sumOf(files, metric, field) {
  return files.reduce((sum, [, entry]) => sum + entry[metric][field], 0);
}

/** Totals that are not the sum of their files were not measured. */
function aggregateIssues(total, files) {
  if (files.length === 0) return [];
  const isValid = files.every(([, entry]) =>
    METRICS.every((metric) => counterIssue(entry?.[metric]) === null),
  );
  if (!isValid) return [];
  return METRICS.filter(
    (metric) =>
      counterIssue(total[metric]) === null &&
      (sumOf(files, metric, "covered") !== total[metric].covered ||
        sumOf(files, metric, "total") !== total[metric].total),
  ).map((metric) => `aggregate_mismatch:${metric}`);
}

function fileGap(file, entry) {
  return {
    file,
    uncovered: Object.fromEntries(
      METRICS.map((metric) => [
        metric,
        (entry?.[metric]?.total ?? 0) - (entry?.[metric]?.covered ?? 0),
      ]),
    ),
  };
}

/**
 * Checks raw coverage counters; a rounded percentage proves nothing.
 *
 * @param summary - The parsed `coverage-summary.json`.
 * @returns The totals, per-file gaps and every reason the scope is not complete.
 *
 * @remarks
 * Fails closed: a count must be a finite whole number of at least 0 with
 * `covered <= total`, in the total and in every file, and the total must be the
 * sum of its files.
 */
export function evaluateCoverage(summary) {
  const total = summary?.total;
  if (!total) return { totals: null, gaps: [], issues: ["summary_invalid"] };
  const issues = METRICS.flatMap((metric) =>
    metricIssues(total[metric], metric, ""),
  );
  const totals = Object.fromEntries(
    METRICS.filter((metric) => counterIssue(total[metric]) === null).map(
      (metric) => [
        metric,
        {
          covered: total[metric].covered,
          total: total[metric].total,
          skipped: total[metric].skipped ?? 0,
        },
      ],
    ),
  );
  if (totals.statements?.total === 0) issues.push("population_empty");
  const files = Object.entries(summary).filter(([file]) => file !== "total");
  const gaps = [];
  for (const [file, entry] of files) {
    const fileIssues = METRICS.flatMap((metric) =>
      metricIssues(entry?.[metric], metric, `file:${file}:`),
    );
    if (fileIssues.length > 0) gaps.push(fileGap(file, entry));
    issues.push(
      ...fileIssues.filter((issue) => !/:incomplete:[a-z]+$/u.test(issue)),
    );
  }
  issues.push(...aggregateIssues(total, files));
  return { totals, gaps, issues };
}

/**
 * Compares the files of a coverage summary with the files its scope must have.
 *
 * @param summaryFiles - Absolute paths in the summary, without `total`.
 * @param files - Repository-relative paths of the checkout.
 * @param scope - A key of {@link COVERAGE_POPULATIONS}.
 * @param root - The checkout.
 */
export function populationIssues(summaryFiles, files, scope, root) {
  const population = COVERAGE_POPULATIONS[scope];
  const expected = files.filter(
    (file) =>
      population.include.some((glob) => path.matchesGlob(file, glob)) &&
      !population.exclude.some((glob) => path.matchesGlob(file, glob)),
  );
  const present = new Set(
    summaryFiles.map((file) => path.relative(root, file).replaceAll("\\", "/")),
  );
  const wanted = new Set(expected);
  return [
    ...expected
      .filter((file) => !present.has(file))
      .map((file) => `population_missing:${file}`),
    ...[...present]
      .filter((file) => !wanted.has(file))
      .map((file) => `population_extra:${file}`),
  ];
}

function readLeadingStatus(text) {
  const [firstLine = ""] = text.trim().split("\n", 1);
  const fence = /^```json[^\n]*\n([\s\S]*?)\n```/u.exec(text.trim());
  try {
    return JSON.parse(fence ? fence[1] : firstLine)?.status ?? null;
  } catch {
    return null;
  }
}

function readReportIssues(text) {
  const last = [...text.matchAll(REPORT_BLOCK)].at(-1);
  if (!last) return ["report_missing"];
  let report;
  try {
    report = JSON.parse(last[1]);
  } catch {
    return ["report_invalid"];
  }
  if (!Array.isArray(report?.todos) || !Array.isArray(report?.criteria)) {
    return ["report_invalid"];
  }
  return [
    ...report.todos
      .filter((todo) => todo?.status !== "done")
      .map((todo) => `todo_open:${todo?.id}`),
    ...report.criteria
      .filter((entry) => entry?.met !== true || !entry?.evidence)
      .map((entry) => `criterion_unmet:${entry?.id}`),
  ];
}

function readCoverageIssues(text, scope) {
  const line = new RegExp(`^coverage-${scope}: (.+)$`, "mu").exec(text)?.[1];
  if (!line) return [`coverage_missing:${scope}`];
  let totals;
  try {
    totals = JSON.parse(line);
  } catch {
    return [`coverage_invalid:${scope}`];
  }
  return evaluateCoverage({ total: totals }).issues.map(
    (issue) => `coverage_${scope}:${issue}`,
  );
}

/**
 * Decides whether a QA report releases Git; everything else blocks it.
 *
 * @param text - The whole report as the QA step answered.
 * @param report - `pages` or `mcp`, each judged on its own.
 * @param currentFingerprint - The fingerprint of the checkout now.
 * @returns Every reason the report does not release Git; empty when it does.
 *
 * @remarks
 * A report names `<report>-fingerprint: <hash>` and one line
 * `coverage-<scope>: <totals of the coverage command>` per scope, so stale
 * evidence and counters below their total are found without reading prose.
 */
export function evaluateHandoff(text, report, currentFingerprint) {
  const issues = [];
  const status = readLeadingStatus(text);
  if (status !== "done") issues.push(`status:${status}`);
  issues.push(...readReportIssues(text));
  const named = new RegExp(
    `^${report}-fingerprint: ([0-9a-f]{64})$`,
    "mu",
  ).exec(text)?.[1];
  if (!named) issues.push("fingerprint_missing");
  else if (named !== currentFingerprint) issues.push("fingerprint_stale");
  for (const scope of REPORT_COVERAGE_SCOPES[report]) {
    issues.push(...readCoverageIssues(text, scope));
  }
  return issues;
}

/** Whether a coverage summary predates the newest source file it should cover. */
export function isSummaryStale(summaryTime, newestSourceTime) {
  return summaryTime < newestSourceTime;
}

/**
 * Compares the installed modules of a package with its lockfile.
 *
 * @returns Why the modules cannot serve a gate; empty when they can.
 */
export function inspectDependencies(input) {
  if (input.lockfile === null) return ["lockfile_missing"];
  if (input.installedLockfile === null) return ["modules_missing"];
  const issues = [];
  if (input.installedLockfile !== input.lockfile) issues.push("lockfile_stale");
  if (input.state?.settings?.enableGlobalVirtualStore !== false) {
    issues.push("modules_layout_stale");
  }
  return issues;
}

function readOptional(file) {
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

function readJsonOptional(file) {
  const text = readOptional(file);
  return text === null ? null : JSON.parse(text);
}

function dependencyIssues(root, directory) {
  const base = path.join(root, directory);
  return inspectDependencies({
    lockfile: readOptional(path.join(base, "pnpm-lock.yaml")),
    installedLockfile: readOptional(
      path.join(base, "node_modules/.pnpm/lock.yaml"),
    ),
    state: readJsonOptional(
      path.join(base, "node_modules/.pnpm-workspace-state-v1.json"),
    ),
  });
}

function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function installedLockHash(root, scope) {
  const file = path.join(root, PACKAGES[scope], "node_modules/.pnpm/lock.yaml");
  return existsSync(file) ? sha256File(file) : "missing";
}

function gitTrackedFiles(root) {
  const result = spawnSync("git", ["ls-files", "-z", "--cached"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return result.status === 0 ? result.stdout.split("\0").filter(Boolean) : [];
}

/**
 * Lists the files of a checkout by the explicit classification, independent of
 * ignore rules. Git only adds what the walk cannot know: tracked files, which
 * count even when an ignore rule matches them, and tracked files that were deleted.
 */
function listRepositoryFiles(root, listTracked) {
  return [
    ...new Set([...walkFiles(root, isFingerprintedFile), ...listTracked(root)]),
  ];
}

/**
 * The manifest of a checkout now.
 *
 * @param root - The checkout.
 * @param scope - `pages` or `mcp`.
 * @param listTracked - The tracked files; a checkout without Git has none.
 */
export function currentManifest(root, scope, listTracked = gitTrackedFiles) {
  const files = listRepositoryFiles(root, listTracked).filter((file) =>
    isInFingerprintScope(file, scope),
  );
  return buildManifest(
    files,
    (file) => {
      const absolute = path.join(root, file);
      return existsSync(absolute) ? sha256File(absolute) : null;
    },
    {
      installedLockfile: installedLockHash(root, scope),
      node: process.version,
    },
  );
}

function fingerprintCommand(root, scope, manifestFile) {
  const result = currentManifest(root, scope);
  if (manifestFile) writeFileSync(manifestFile, result.manifest);
  console.info(
    JSON.stringify({
      scope,
      fingerprint: result.fingerprint,
      fileCount: result.fileCount,
    }),
  );
  return 0;
}

function newestSourceTime(root, scope) {
  return Math.max(
    ...listRepositoryFiles(root, gitTrackedFiles)
      .filter((file) => isInFingerprintScope(file, scope))
      .map((file) => path.join(root, file))
      .filter((file) => existsSync(file))
      .map((file) => statSync(file).mtimeMs),
  );
}

function coverageCommand(root, input) {
  const summary = readJsonOptional(input.summary);
  if (summary === null) {
    console.error(`[qa] FAILED: no coverage summary at ${input.summary}.`);
    return 1;
  }
  const result = evaluateCoverage(summary);
  if (
    isSummaryStale(
      statSync(input.summary).mtimeMs,
      newestSourceTime(root, input.scope),
    )
  ) {
    result.issues.push("summary_stale");
  }
  if (input.population) {
    const base = path.join(
      root,
      COVERAGE_POPULATIONS[input.population].directory,
    );
    const files = walkFiles(base, isFingerprintedFile);
    result.issues.push(
      ...populationIssues(
        Object.keys(summary).filter((file) => file !== "total"),
        files.filter((file) => existsSync(path.join(base, file))),
        input.population,
        base,
      ),
    );
  }
  if (input.gaps)
    writeFileSync(input.gaps, JSON.stringify(result.gaps, null, 2));
  console.info(
    JSON.stringify({
      summary: input.summary,
      totals: result.totals,
      filesWithGaps: result.gaps.length,
      issues: result.issues.slice(0, 50),
      issueCount: result.issues.length,
    }),
  );
  return result.issues.length === 0 && result.gaps.length === 0 ? 0 : 1;
}

function preflightCommand(root, scope, shouldInstall) {
  const directory = PACKAGES[scope];
  let issues = dependencyIssues(root, directory);
  if (issues.length > 0 && shouldInstall) {
    // `CI` allows the purge of stale modules without a terminal; the frozen
    // lockfile keeps the installed versions exactly the reviewed ones.
    const install = spawnSync(
      "pnpm",
      ["--dir", directory, "install", "--frozen-lockfile"],
      {
        cwd: root,
        env: { ...process.env, CI: "true" },
        stdio: ["ignore", "inherit", "inherit"],
      },
    );
    if (install.status !== 0) {
      console.error(
        `[qa] FAILED: install of ${scope} ended with ${install.status}.`,
      );
      return 1;
    }
    issues = dependencyIssues(root, directory);
  }
  console.info(JSON.stringify({ scope, node: process.version, issues }));
  return issues.length === 0 ? 0 : 1;
}

/**
 * Binds a QA report to the checkout as it is now.
 *
 * @returns Every reason the report does not release Git.
 */
export function handoffIssues(
  root,
  report,
  text,
  listTracked = gitTrackedFiles,
) {
  return evaluateHandoff(
    text,
    report,
    currentManifest(root, report, listTracked).fingerprint,
  );
}

function handoffCommand(root, report, file) {
  const issues = handoffIssues(root, report, readFileSync(file, "utf8"));
  console.info(
    JSON.stringify({ report, released: issues.length === 0, issues }),
  );
  return issues.length === 0 ? 0 : 1;
}

function readOption(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function main(args) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const [command] = args;
  const scope = readOption(args, "--scope");
  if (!Object.hasOwn(PACKAGES, scope ?? "")) {
    console.error(
      "Usage: qa-evidence.mjs preflight --scope pages|mcp [--install] | fingerprint --scope pages|mcp [--manifest <file>] | coverage --scope pages|mcp --summary <file> [--gaps <file>] [--population backend|frontend|mcp] | verify-handoff --scope pages|mcp --file <report>",
    );
    return USAGE_EXIT_CODE;
  }
  if (command === "coverage" && readOption(args, "--summary")) {
    return coverageCommand(root, {
      scope,
      summary: readOption(args, "--summary"),
      gaps: readOption(args, "--gaps"),
      population: readOption(args, "--population"),
    });
  }
  if (command === "verify-handoff" && readOption(args, "--file")) {
    return handoffCommand(root, scope, readOption(args, "--file"));
  }
  if (command === "preflight") {
    return preflightCommand(root, scope, args.includes("--install"));
  }
  if (command === "fingerprint") {
    return fingerprintCommand(root, scope, readOption(args, "--manifest"));
  }
  console.error(`Unknown command: ${command}`);
  return USAGE_EXIT_CODE;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main(process.argv.slice(2));
}
