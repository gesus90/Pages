import { findCsvDelimiter } from "../code-detection";
import { splitCsv } from "../csv-parse";

import {
  MAXIMUM_SHEETS,
  MAXIMUM_SHEET_COLUMNS,
  MAXIMUM_SHEET_ROWS,
} from "./document-model";
import { readRelations } from "./office-package";
import {
  attributeOf,
  childNamed,
  childrenNamed,
  descendantNamed,
  descendantsNamed,
  parseXml,
  relationIdOf,
  textOf,
} from "./xml-nodes";

import type { Sheet, SheetCell, SheetDocument } from "./document-model";
import type { ZipArchive } from "./zip-entries";

const WORKBOOK_PART = "xl/workbook.xml";
const CELL_REFERENCE = /^([A-Z]+)(\d+)$/u;
const NUMBER_TEXT = /^[-+]?(?:\d+[.,]?\d*|[.,]\d+)(?:[eE][-+]?\d+)?$/u;
/** Built-in number formats of Excel that show a date or a time. */
const DATE_FORMAT_IDS: ReadonlySet<number> = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47,
]);
/** Days between 1899-12-30, day 0 of Excel, and 1970-01-01. */
const EXCEL_EPOCH_DAYS = 25_569;
const MILLISECONDS_PER_DAY = 86_400_000;

/** The kind of display a cell style asks for. */
type CellDisplay = "number" | "date" | "percent";

const EMPTY_CELL: SheetCell = { text: "", number: null };

/**
 * The index of a column from its letters.
 *
 * @param letters - Such as `A`, `Z` or `AB`.
 * @returns The index from 0.
 */
export function columnIndex(letters: string): number {
  let index = 0;
  for (const letter of letters)
    index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

/**
 * The letters of a column, as a table head shows them.
 *
 * @param index - The index from 0.
 * @returns Such as `A`, `Z` or `AA`.
 */
export function columnLetters(index: number): string {
  let rest = index + 1;
  let letters = "";
  while (rest > 0) {
    const remainder = (rest - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    rest = Math.floor((rest - 1) / 26);
  }
  return letters;
}

/**
 * Reads a cell text as a number when it is one, with a dot or a comma as
 * decimal sign.
 *
 * @param text - The text of the cell.
 * @returns The number, or `null` for any other text.
 */
export function numberOfText(text: string): number | null {
  const trimmed = text.trim();
  if (!NUMBER_TEXT.test(trimmed)) return null;
  const value = Number(trimmed.replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

/** Every row as long as the widest one, trailing empty rows left out. */
function squared(rows: SheetCell[][]): {
  rows: SheetCell[][];
  columnCount: number;
} {
  while (
    rows.length > 0 &&
    (rows.at(-1) ?? []).every((cell) => cell.text === "")
  )
    rows.pop();
  let columnCount = 0;
  for (const row of rows) {
    let last = row.length - 1;
    while (last >= 0 && row[last]?.text === "") last -= 1;
    columnCount = Math.max(columnCount, last + 1);
  }
  return {
    rows: rows.map((row) =>
      Array.from(
        { length: columnCount },
        (_, column) => row[column] ?? EMPTY_CELL,
      ),
    ),
    columnCount,
  };
}

/** Builds a sheet from rows, within the limits of rows and columns. */
export function sheetOf(
  name: string,
  input: readonly (readonly SheetCell[])[],
  isCut = false,
): Sheet {
  const isTruncated =
    isCut ||
    input.length > MAXIMUM_SHEET_ROWS ||
    input.some((row) => row.length > MAXIMUM_SHEET_COLUMNS);
  const limited = input
    .slice(0, MAXIMUM_SHEET_ROWS)
    .map((row) => row.slice(0, MAXIMUM_SHEET_COLUMNS));
  const { rows, columnCount } = squared(limited);
  return { name, rows, columnCount, isTruncated };
}

/** Decodes CSV bytes as UTF-8, or as Windows-1252 when they are no valid UTF-8. */
function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true })
      .decode(bytes)
      .replace(/^﻿/u, "");
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/**
 * Reads a CSV or TSV file as a table (PAGE-385).
 *
 * @param bytes - The file.
 * @param options - The name of the file and whether it is a TSV file; the
 * delimiter of a CSV file is recognized: tab, semicolon or comma.
 */
export function readCsvDocument(
  bytes: Uint8Array,
  options: { readonly name: string; readonly isTab: boolean },
): SheetDocument {
  const text = decodeText(bytes);
  const lines = text.split(/\r?\n/u).filter((line) => line.trim() !== "");
  const delimiter = options.isTab ? "\t" : (findCsvDelimiter(lines) ?? ",");
  const rows = splitCsv(text, delimiter).map((row) =>
    row.map((field) => ({ text: field, number: numberOfText(field) })),
  );
  return { kind: "sheet", sheets: [sheetOf(options.name, rows)], delimiter };
}

/** The texts of the shared strings, without phonetic hints. */
async function readSharedStrings(archive: ZipArchive): Promise<string[]> {
  const text = await archive.readText("xl/sharedStrings.xml");
  const root = text === null ? null : parseXml(text);
  if (!root) return [];
  return childrenNamed(root, "si").map((item) => {
    const plain = childNamed(item, "t");
    if (plain) return plain.textContent ?? "";
    return childrenNamed(item, "r")
      .map((run) => textOf(childNamed(run, "t")))
      .join("");
  });
}

/** Whether a custom number format shows a date or time, ignoring quoted text and colors. */
function isDateFormat(code: string): boolean {
  const plain = code.replace(/"[^"]*"|\[[^\]]*\]|\\./gu, "");
  return /[dyhs]/iu.test(plain) || (/m/iu.test(plain) && !/[0#]/u.test(plain));
}

/** How each cell style shows its number, by the index of the style. */
async function readCellDisplays(archive: ZipArchive): Promise<CellDisplay[]> {
  const text = await archive.readText("xl/styles.xml");
  const root = text === null ? null : parseXml(text);
  if (!root) return [];
  const custom = new Map<number, string>();
  for (const format of descendantsNamed(root, "numFmt"))
    custom.set(
      Number(attributeOf(format, "numFmtId")),
      attributeOf(format, "formatCode") ?? "",
    );
  const cellFormats = descendantNamed(root, "cellXfs");
  return (cellFormats ? childrenNamed(cellFormats, "xf") : []).map((format) => {
    const id = Number(attributeOf(format, "numFmtId") ?? "0");
    const code = custom.get(id) ?? "";
    if (DATE_FORMAT_IDS.has(id) || (code !== "" && isDateFormat(code)))
      return "date";
    if (id === 9 || id === 10 || code.includes("%")) return "percent";
    return "number";
  });
}

/** Shows a stored number as its style asks: a date, a percentage, or the number. */
function displayNumber(value: number, display: CellDisplay): string {
  if (display === "percent")
    return `${String(Math.round(value * 10_000) / 100)} %`;
  if (display !== "date") return String(value);
  const date = new Date(
    Math.round((value - EXCEL_EPOCH_DAYS) * MILLISECONDS_PER_DAY),
  );
  const iso = date.toISOString();
  if (value < 1) return iso.slice(11, 19);
  return Number.isInteger(value)
    ? iso.slice(0, 10)
    : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

interface CellSources {
  readonly strings: readonly string[];
  readonly displays: readonly CellDisplay[];
}

/** The stored value of a cell; a formula shows its last stored result, nothing is recalculated. */
function readCell(cell: Element, sources: CellSources): SheetCell {
  const type = attributeOf(cell, "t") ?? "n";
  const stored = textOf(childNamed(cell, "v"));
  if (type === "s")
    return { text: sources.strings[Number(stored)] ?? "", number: null };
  if (type === "inlineStr")
    return { text: textOf(childNamed(cell, "is")), number: null };
  if (type === "b")
    return { text: stored === "1" ? "TRUE" : "FALSE", number: null };
  if (type !== "n" || stored === "") return { text: stored, number: null };
  const value = Number(stored);
  if (!Number.isFinite(value)) return { text: stored, number: null };
  const display =
    sources.displays[Number(attributeOf(cell, "s") ?? "0")] ?? "number";
  return {
    text: displayNumber(value, display),
    number: display === "date" ? null : value,
  };
}

/** Places the cells of a row by their references; cells without one follow the previous. */
function readRow(row: Element, sources: CellSources): SheetCell[] {
  const cells: SheetCell[] = [];
  for (const cell of childrenNamed(row, "c")) {
    const match = CELL_REFERENCE.exec(attributeOf(cell, "r") ?? "");
    const column = match ? columnIndex(match[1] ?? "A") : cells.length;
    if (column >= MAXIMUM_SHEET_COLUMNS) break;
    while (cells.length < column) cells.push(EMPTY_CELL);
    cells[column] = readCell(cell, sources);
  }
  return cells;
}

async function readWorksheet(
  archive: ZipArchive,
  path: string,
  sources: CellSources,
): Promise<{ rows: SheetCell[][]; isCut: boolean }> {
  const text = await archive.readText(path);
  const root = text === null ? null : parseXml(text);
  const sheetData = root ? descendantNamed(root, "sheetData") : null;
  const rows: SheetCell[][] = [];
  if (!sheetData) return { rows, isCut: false };
  for (const row of childrenNamed(sheetData, "row")) {
    const number = Number(attributeOf(row, "r") ?? String(rows.length + 1));
    if (number > MAXIMUM_SHEET_ROWS) return { rows, isCut: true };
    while (rows.length < number - 1) rows.push([]);
    rows[number - 1] = readRow(row, sources);
  }
  return { rows, isCut: false };
}

/**
 * Reads an Excel workbook (`.xlsx`) as tables, one per visible sheet (PAGE-385).
 *
 * @remarks
 * A formula shows the value the file stored for it; nothing is recalculated
 * and no macro runs. Dates and percentages follow the number format of the
 * cell; other numbers stay numbers for alignment, sorting and sums.
 *
 * @param archive - The opened package.
 * @returns The workbook, or `null` without `xl/workbook.xml`.
 */
export async function readWorkbook(
  archive: ZipArchive,
): Promise<SheetDocument | null> {
  const text = await archive.readText(WORKBOOK_PART);
  const root = text === null ? null : parseXml(text);
  if (!root) return null;
  const relations = await readRelations(archive, WORKBOOK_PART);
  const sources: CellSources = {
    strings: await readSharedStrings(archive),
    displays: await readCellDisplays(archive),
  };
  const sheets: Sheet[] = [];
  for (const sheet of descendantsNamed(root, "sheet").slice(
    0,
    MAXIMUM_SHEETS,
  )) {
    const relation = relations.get(relationIdOf(sheet) ?? "");
    if (
      !relation ||
      relation.isExternal ||
      attributeOf(sheet, "state") === "hidden"
    )
      continue;
    const { rows, isCut } = await readWorksheet(
      archive,
      relation.target,
      sources,
    );
    sheets.push(
      sheetOf(
        attributeOf(sheet, "name") ?? columnLetters(sheets.length),
        rows,
        isCut,
      ),
    );
  }
  return { kind: "sheet", sheets, delimiter: null };
}
