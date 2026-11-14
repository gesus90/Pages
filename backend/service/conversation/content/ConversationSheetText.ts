import type { ChatDocumentSheet } from "@/backend/service/chat/ChatDocumentReader";

/** Rows and columns of a CSV or TSV file read at most (PAGE-386). */
const MAXIMUM_ROWS = 100_000;
const MAXIMUM_COLUMNS = 200;

/** Data rows one reading of a table returns at most. */
export const SHEET_WINDOW_ROWS = 200;

/** Characters one reading of a table returns at most. */
const SHEET_WINDOW_CHARACTERS = 20_000;

/** Reads one field of a delimited line; returns it and where the next one starts. */
function readField(
  text: string,
  start: number,
  delimiter: string,
): { readonly value: string; readonly next: number; readonly isRowEnd: boolean } {
  if (text[start] !== '"') {
    let end = start;
    while (
      end < text.length &&
      text[end] !== delimiter &&
      text[end] !== "\n" &&
      text[end] !== "\r"
    )
      end += 1;
    return finishField(text, text.slice(start, end), end);
  }
  let value = "";
  let cursor = start + 1;
  while (cursor < text.length) {
    if (text[cursor] === '"' && text[cursor + 1] === '"') {
      value += '"';
      cursor += 2;
    } else if (text[cursor] === '"') {
      cursor += 1;
      break;
    } else {
      value += text[cursor];
      cursor += 1;
    }
  }
  while (
    cursor < text.length &&
    text[cursor] !== delimiter &&
    text[cursor] !== "\n" &&
    text[cursor] !== "\r"
  )
    cursor += 1;
  return finishField(text, value, cursor);
}

function finishField(
  text: string,
  value: string,
  end: number,
): { readonly value: string; readonly next: number; readonly isRowEnd: boolean } {
  if (end >= text.length) return { value, next: end, isRowEnd: true };
  if (text[end] === "\r" && text[end + 1] === "\n")
    return { value, next: end + 2, isRowEnd: true };
  if (text[end] === "\n" || text[end] === "\r")
    return { value, next: end + 1, isRowEnd: true };
  return { value, next: end + 1, isRowEnd: false };
}

/**
 * Reads a CSV or TSV file into one sheet (PAGE-386): quoted fields may hold
 * the delimiter, quotes and line breaks; a CSV whose first line has more
 * semicolons than commas is read with semicolons, as spreadsheets in German
 * write it.
 *
 * @param text - The text of the file.
 * @param isTabSeparated - Whether the file is a TSV.
 * @returns The sheet and whether rows were left out beyond the limit.
 */
export function readDelimitedSheet(
  text: string,
  isTabSeparated: boolean,
): { readonly sheet: ChatDocumentSheet; readonly isTruncated: boolean } {
  const source = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const firstLine = source.split("\n", 1)[0] ?? "";
  const delimiter = isTabSeparated
    ? "\t"
    : firstLine.split(";").length > firstLine.split(",").length
      ? ";"
      : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const field = readField(source, cursor, delimiter);
    if (row.length < MAXIMUM_COLUMNS) row.push(field.value);
    cursor = field.next;
    if (!field.isRowEnd) continue;
    rows.push(row);
    row = [];
    if (rows.length >= MAXIMUM_ROWS)
      return { sheet: { name: "", rows }, isTruncated: cursor < source.length };
  }
  if (row.length > 0) rows.push(row);
  return { sheet: { name: "", rows }, isTruncated: false };
}

/** Which part of a table an agent reads. */
export interface SheetWindowRequest {
  /** The sheet by name; the first sheet without it. */
  readonly sheet?: string;
  /** The first data row, counted from 1 below the header row. */
  readonly fromRow?: number;
}

/** One part of a table as the agent reads it. */
export interface SheetWindow {
  readonly sheet: string;
  readonly header: readonly string[];
  /** The data rows, each with its number below the header row. */
  readonly rows: readonly { readonly number: number; readonly cells: readonly string[] }[];
  /** Data rows and columns of the whole sheet. */
  readonly totalRows: number;
  readonly totalColumns: number;
  /** The first data row after this window; `null` when the sheet ends. */
  readonly nextRow: number | null;
}

/**
 * Cuts one part of a table for the agent: the header row and at most
 * {@link SHEET_WINDOW_ROWS} data rows from a row on, within a character
 * limit, with the full size of the sheet and where to read on.
 *
 * @param sheets - The sheets of the table.
 * @param request - The sheet and the first data row.
 * @returns The window, or `null` when no sheet has the name.
 */
export function sheetWindow(
  sheets: readonly ChatDocumentSheet[],
  request: SheetWindowRequest,
): SheetWindow | null {
  const named = request.sheet?.trim().toLowerCase();
  const sheet =
    named === undefined || named === ""
      ? sheets[0]
      : sheets.find((entry) => entry.name.trim().toLowerCase() === named);
  if (!sheet) return null;
  const [header = [], ...data] = sheet.rows;
  const start = Math.max(1, request.fromRow ?? 1);
  const rows: { number: number; cells: readonly string[] }[] = [];
  let characters = header.join("\t").length;
  for (let number = start; number <= data.length; number += 1) {
    const cells = data[number - 1] ?? [];
    characters += cells.join("\t").length + 1;
    if (
      rows.length >= SHEET_WINDOW_ROWS ||
      (rows.length > 0 && characters > SHEET_WINDOW_CHARACTERS)
    )
      break;
    rows.push({ number, cells });
  }
  const last = rows.at(-1)?.number ?? start - 1;
  return {
    sheet: sheet.name,
    header,
    rows,
    totalRows: data.length,
    totalColumns: Math.max(0, ...sheet.rows.map((entry) => entry.length)),
    nextRow: last < data.length ? last + 1 : null,
  };
}

/**
 * The sheets of a table as plain text for the search of the chat.
 *
 * @param sheets - The sheets.
 */
export function sheetsSearchText(sheets: readonly ChatDocumentSheet[]): string {
  return sheets
    .map((sheet) =>
      [sheet.name, ...sheet.rows.map((row) => row.join("\t"))].join("\n"),
    )
    .join("\n\n");
}
