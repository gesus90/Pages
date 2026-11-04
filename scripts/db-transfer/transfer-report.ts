import type { RemovedNulColumn } from "./nul-removal";

/** Digits of a checksum in the report; the comparison uses all of them. */
const CHECKSUM_DIGITS = 16;

const MILLISECONDS_PER_SECOND = 1000;

/** The numbers of one table after the check. */
export interface TableOutcome {
  readonly table: string;
  readonly sourceRows: number;
  readonly targetRows: number;
  /** Checksum of the rows of the source without U+0000, which the target has to hold. */
  readonly expectedChecksum: string;
  readonly targetChecksum: string;
  /** `null` when this run did not copy. */
  readonly copyMs: number | null;
  readonly checkMs: number;
}

/** The value of one sequence on both sides; `null` where it does not exist. */
export interface SequenceOutcome {
  readonly sequence: string;
  readonly sourceNext: bigint | null;
  readonly targetNext: bigint | null;
}

/** Everything the report of one run holds. */
export interface TransferReport {
  readonly tables: readonly TableOutcome[];
  readonly sequences: readonly SequenceOutcome[];
  /** The columns that lost U+0000, in any order. */
  readonly removedNul: readonly RemovedNulColumn[];
  readonly totalMs: number;
  /** Whether this run copied, so its duration is that of a switch. */
  readonly hasCopied: boolean;
}

function seconds(milliseconds: number): string {
  return (milliseconds / MILLISECONDS_PER_SECOND).toFixed(1);
}

function tableMatches(outcome: TableOutcome): boolean {
  return (
    outcome.sourceRows === outcome.targetRows &&
    outcome.expectedChecksum === outcome.targetChecksum
  );
}

function tableLine(outcome: TableOutcome): string {
  return [
    outcome.table.padEnd(44),
    String(outcome.sourceRows).padStart(9),
    String(outcome.targetRows).padStart(9),
    outcome.expectedChecksum.slice(0, CHECKSUM_DIGITS),
    outcome.targetChecksum.slice(0, CHECKSUM_DIGITS),
    (outcome.copyMs === null ? "-" : seconds(outcome.copyMs)).padStart(8),
    seconds(outcome.checkMs).padStart(8),
    tableMatches(outcome) ? "ok" : "DEVIATION",
  ].join(" ");
}

function sequenceLine(outcome: SequenceOutcome): string {
  return [
    outcome.sequence.padEnd(44),
    String(outcome.sourceNext ?? "-").padStart(9),
    String(outcome.targetNext ?? "-").padStart(9),
    outcome.sourceNext === outcome.targetNext ? "ok" : "DEVIATION",
  ].join(" ");
}

function removedNulLines(columns: readonly RemovedNulColumn[]): string[] {
  const values = columns.reduce((sum, column) => sum + column.values, 0);
  const characters = columns.reduce(
    (sum, column) => sum + column.characters,
    0,
  );
  const sorted = [...columns].sort((first, second) =>
    `${first.table}.${first.column}`.localeCompare(
      `${second.table}.${second.column}`,
    ),
  );
  return [
    `${"column without U+0000".padEnd(64)} ${"values".padStart(9)} ${"chars".padStart(9)}`,
    ...sorted.map(
      (column) =>
        `${`${column.table}.${column.column}`.padEnd(64)} ${String(column.values).padStart(9)} ${String(column.characters).padStart(9)}`,
    ),
    `U+0000 removed on purpose: ${String(values)} values, ${String(characters)} characters, ${String(columns.length)} columns. The checksums compare the target with the source without this character.`,
  ];
}

function summaryLines(report: TransferReport, deviations: number): string[] {
  const rows = report.tables.reduce(
    (sum, outcome) => sum + outcome.sourceRows,
    0,
  );
  return [
    `Tables: ${String(report.tables.length)}, rows: ${String(rows)}, sequences: ${String(report.sequences.length)}, deviations: ${String(deviations)}`,
    report.hasCopied
      ? `Total duration: ${seconds(report.totalMs)} s. This is the expected downtime of the switch, plus stopping and starting Pages.`
      : `Total duration of the check: ${seconds(report.totalMs)} s.`,
  ];
}

/**
 * Prints the report: names and numbers, no content.
 *
 * @param report - The outcome of the run.
 * @returns The number of deviations.
 */
export function printReport(report: TransferReport): number {
  const deviating = [
    ...report.tables
      .filter((outcome) => !tableMatches(outcome))
      .map((outcome) => outcome.table),
    ...report.sequences
      .filter((outcome) => outcome.sourceNext !== outcome.targetNext)
      .map((outcome) => outcome.sequence),
  ];
  const lines = [
    `${"table".padEnd(44)} ${"rows src".padStart(9)} ${"rows dst".padStart(9)} ${"checksum exp".padEnd(CHECKSUM_DIGITS)} ${"checksum dst".padEnd(CHECKSUM_DIGITS)} ${"copy s".padStart(8)} ${"check s".padStart(8)} result`,
    ...report.tables.map(tableLine),
    "",
    `${"sequence".padEnd(44)} ${"next src".padStart(9)} ${"next dst".padStart(9)} result`,
    ...report.sequences.map(sequenceLine),
    "",
    ...removedNulLines(report.removedNul),
    "",
    ...summaryLines(report, deviating.length),
  ];
  console.info(lines.join("\n"));
  if (deviating.length > 0)
    console.error(`Deviation in: ${deviating.join(", ")}`);
  return deviating.length;
}
