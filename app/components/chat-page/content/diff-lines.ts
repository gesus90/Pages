/** Role of one line of a unified diff. */
export type DiffLineKind = "context" | "added" | "removed" | "hunk" | "meta";

/** One line of a unified diff with its line numbers on both sides. */
export interface DiffLine {
  readonly kind: DiffLineKind;
  /** Line without its leading `+`, `-` or space marker; hunk and meta lines keep the whole text. */
  readonly text: string;
  /** Line number in the old file, `null` for added, hunk and meta lines. */
  readonly oldNumber: number | null;
  /** Line number in the new file, `null` for removed, hunk and meta lines. */
  readonly newNumber: number | null;
}

/** Result of parsing a unified diff. */
export interface ParsedDiff {
  /** Path from `+++ b/path`, or from `--- a/path` when the new side is `/dev/null`; `null` when absent. */
  readonly fileName: string | null;
  readonly lines: readonly DiffLine[];
  /** Number of added lines. */
  readonly added: number;
  /** Number of removed lines. */
  readonly removed: number;
}

/** One row of the side-by-side view; `null` pads the shorter side. */
export interface DiffRow {
  readonly left: DiffLine | null;
  readonly right: DiffLine | null;
}

interface DiffCounters {
  oldNumber: number;
  newNumber: number;
  /** Lines the current hunk header still announces for the old side. */
  oldRemaining: number;
  /** Lines the current hunk header still announces for the new side. */
  newRemaining: number;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const OLD_FILE_PREFIX = "--- ";
const NEW_FILE_PREFIX = "+++ ";
const META_PREFIXES: readonly string[] = [
  "diff ",
  "index ",
  OLD_FILE_PREFIX,
  NEW_FILE_PREFIX,
  "new file mode ",
  "deleted file mode ",
  "old mode ",
  "new mode ",
  "similarity index ",
  "dissimilarity index ",
  "rename from ",
  "rename to ",
  "copy from ",
  "copy to ",
  "Binary files ",
  "GIT binary patch",
];

function splitLines(source: string): string[] {
  const lines = source
    .split("\n")
    .map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  // A final line break ends the last line, it does not start an empty context line.
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

function isMetaLine(line: string): boolean {
  return META_PREFIXES.some((prefix) => line.startsWith(prefix));
}

function isHunkBodyLine(line: string, counters: DiffCounters): boolean {
  const isInsideHunk = counters.oldRemaining > 0 || counters.newRemaining > 0;
  return isInsideHunk && (line === "" || "+- ".includes(line.charAt(0)));
}

function classifyLine(line: string, counters: DiffCounters): DiffLineKind {
  if (line.startsWith("@@")) {
    return "hunk";
  }
  if (line.startsWith("\\")) {
    return "meta";
  }
  // Inside an announced hunk a removed line may itself start with "-- ",
  // so file headers are only recognised outside of the hunk body.
  if (!isHunkBodyLine(line, counters) && isMetaLine(line)) {
    return "meta";
  }
  if (line.startsWith("+")) {
    return "added";
  }
  if (line.startsWith("-")) {
    return "removed";
  }
  return "context";
}

function startHunk(line: string, counters: DiffCounters): void {
  const match = HUNK_HEADER.exec(line);
  counters.oldRemaining = 0;
  counters.newRemaining = 0;
  if (!match) {
    return;
  }
  counters.oldNumber = Number(match[1]);
  counters.newNumber = Number(match[3]);
  counters.oldRemaining = Number(match[2] ?? "1");
  counters.newRemaining = Number(match[4] ?? "1");
}

function takeOldNumber(counters: DiffCounters): number {
  const lineNumber = counters.oldNumber;
  counters.oldNumber += 1;
  counters.oldRemaining = Math.max(0, counters.oldRemaining - 1);
  return lineNumber;
}

function takeNewNumber(counters: DiffCounters): number {
  const lineNumber = counters.newNumber;
  counters.newNumber += 1;
  counters.newRemaining = Math.max(0, counters.newRemaining - 1);
  return lineNumber;
}

function buildLine(
  kind: DiffLineKind,
  line: string,
  counters: DiffCounters,
): DiffLine {
  if (kind === "hunk") {
    startHunk(line, counters);
  }
  if (kind === "hunk" || kind === "meta") {
    return { kind, text: line, oldNumber: null, newNumber: null };
  }
  if (kind === "added") {
    const newNumber = takeNewNumber(counters);
    return { kind, text: line.slice(1), oldNumber: null, newNumber };
  }
  if (kind === "removed") {
    const oldNumber = takeOldNumber(counters);
    return { kind, text: line.slice(1), oldNumber, newNumber: null };
  }
  return {
    kind,
    text: line.startsWith(" ") ? line.slice(1) : line,
    oldNumber: takeOldNumber(counters),
    newNumber: takeNewNumber(counters),
  };
}

function readFilePath(
  lines: readonly DiffLine[],
  prefix: string,
): string | null {
  const header = lines.find(
    (line) => line.kind === "meta" && line.text.startsWith(prefix),
  );
  if (!header) {
    return null;
  }
  // Classic `diff -u` appends a tab and a timestamp to the path.
  const rawPath = header.text.slice(prefix.length).split("\t")[0]?.trim() ?? "";
  if (rawPath === "" || rawPath === "/dev/null") {
    return null;
  }
  return rawPath.replace(/^[ab]\//, "");
}

function countKind(lines: readonly DiffLine[], kind: DiffLineKind): number {
  return lines.filter((line) => line.kind === kind).length;
}

/**
 * Parses a unified diff into classified, numbered lines.
 *
 * @remarks
 * Line numbers come from `@@ -a,b +c,d @@` headers; without any hunk header
 * numbering starts at 1 on both sides. `diff --git`, `index`, `---`, `+++` and
 * `\ No newline` lines are "meta". Never throws; text that is no diff at all
 * comes back as context lines.
 *
 * @param source - Diff text, with `\n` or `\r\n` line endings.
 * @returns The lines, the file name of the first file, and the change counts.
 */
export function parseUnifiedDiff(source: string): ParsedDiff {
  const counters: DiffCounters = {
    oldNumber: 1,
    newNumber: 1,
    oldRemaining: 0,
    newRemaining: 0,
  };
  const lines = splitLines(source).map((line) =>
    buildLine(classifyLine(line, counters), line, counters),
  );
  return {
    fileName:
      readFilePath(lines, NEW_FILE_PREFIX) ??
      readFilePath(lines, OLD_FILE_PREFIX),
    lines,
    added: countKind(lines, "added"),
    removed: countKind(lines, "removed"),
  };
}

function flushChangeRun(
  rows: DiffRow[],
  removedRun: DiffLine[],
  addedRun: DiffLine[],
): void {
  const rowCount = Math.max(removedRun.length, addedRun.length);
  for (let index = 0; index < rowCount; index += 1) {
    rows.push({
      left: removedRun[index] ?? null,
      right: addedRun[index] ?? null,
    });
  }
  removedRun.length = 0;
  addedRun.length = 0;
}

/**
 * Builds the rows of the side-by-side view ("vorher" / "nachher").
 *
 * @remarks
 * Context and hunk lines appear on both sides. A run of removed lines followed
 * by added lines is paired row by row, the shorter side padded with `null`.
 * Meta lines are omitted and do not interrupt a run, so a `\ No newline`
 * marker between the removed and the added lines keeps them paired.
 *
 * @param lines - Lines of a parsed diff.
 * @returns One row per line pair.
 */
export function pairDiffRows(lines: readonly DiffLine[]): DiffRow[] {
  const rows: DiffRow[] = [];
  const removedRun: DiffLine[] = [];
  const addedRun: DiffLine[] = [];
  for (const line of lines) {
    if (line.kind === "meta") {
      continue;
    }
    if (line.kind === "added") {
      addedRun.push(line);
      continue;
    }
    // Removed lines after added ones start a new change, not a pair with the previous one.
    if (line.kind !== "removed" || addedRun.length > 0) {
      flushChangeRun(rows, removedRun, addedRun);
    }
    if (line.kind === "removed") {
      removedRun.push(line);
      continue;
    }
    rows.push({ left: line, right: line });
  }
  flushChangeRun(rows, removedRun, addedRun);
  return rows;
}
