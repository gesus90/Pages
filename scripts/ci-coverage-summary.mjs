import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Writes the raw coverage counters of each unit scope as Markdown for the
 * GitHub Actions summary of the `ci_test` job (PAGE-290).
 *
 * Usage: `node scripts/ci-coverage-summary.mjs <summary>...`
 *
 * It only shows numbers; the verdict comes from
 * `node scripts/qa-evidence.mjs coverage`. The scopes stay separate, a missing
 * or unreadable report is named as such, and a percentage is rounded down so
 * that an incomplete metric never reads as 100%.
 */

const METRICS = ["statements", "branches", "functions", "lines"];

function readSummary(file) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function formatPercent(counter) {
  if (counter.total === 0) return "n/a";
  return `${Math.floor((counter.covered * 10000) / counter.total) / 100}%`;
}

function isComplete(counter) {
  return counter.covered === counter.total && (counter.skipped ?? 0) === 0;
}

function countFilesWithGaps(summary) {
  return Object.entries(summary).filter(
    ([file, entry]) =>
      file !== "total" &&
      METRICS.some((metric) => !entry?.[metric] || !isComplete(entry[metric])),
  ).length;
}

function describeScope(file) {
  const scope = path.basename(path.dirname(file));
  const summary = readSummary(file);
  const heading = `### Coverage ${scope}`;
  if (!summary?.total) {
    return `${heading}\n\n**No valid report** at \`${file}\`. This scope is not covered.\n`;
  }
  const rows = METRICS.map((metric) => {
    const counter = summary.total[metric];
    if (!counter) return `| ${metric} | missing | missing | missing | n/a |`;
    return `| ${metric} | ${counter.covered} | ${counter.total} | ${counter.skipped ?? 0} | ${formatPercent(counter)} |`;
  });
  const fileCount = Object.keys(summary).length - 1;
  return [
    heading,
    "",
    "| Metric | Covered | Total | Skipped | Percent |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...rows,
    "",
    `${fileCount} files, ${countFilesWithGaps(summary)} with gaps.`,
    "",
  ].join("\n");
}

const files = process.argv.slice(2);
console.info(files.map(describeScope).join("\n"));
