import { findCsvDelimiter } from "./code-detection";

/** A table read from CSV or TSV: the head row and the rows below it. */
export interface CsvTable {
  readonly delimiter: string;
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/** The state of the reader between two characters. */
interface CsvCursor {
  field: string;
  row: string[];
  readonly rows: string[][];
  isQuoted: boolean;
}

function endRow(cursor: CsvCursor): void {
  cursor.row.push(cursor.field);
  cursor.field = "";
  if (cursor.row.length > 1 || cursor.row[0] !== "")
    cursor.rows.push(cursor.row);
  cursor.row = [];
}

function readQuoted(
  cursor: CsvCursor,
  character: string,
  next: string | undefined,
): number {
  if (character !== '"') {
    cursor.field += character;
    return 1;
  }
  if (next === '"') {
    cursor.field += '"';
    return 2;
  }
  cursor.isQuoted = false;
  return 1;
}

/**
 * Splits CSV text into rows of fields, as RFC 4180 describes it: fields in
 * double quotes may hold the delimiter, line breaks and doubled quotes.
 * @param source - The text.
 * @param delimiter - Comma, semicolon or tab.
 * @returns The rows; empty lines are left out.
 */
export function splitCsv(source: string, delimiter: string): string[][] {
  const cursor: CsvCursor = { field: "", row: [], rows: [], isQuoted: false };
  const text = source.replace(/\r\n?/gu, "\n");
  let index = 0;
  while (index < text.length) {
    const character = text[index] ?? "";
    if (cursor.isQuoted) {
      index += readQuoted(cursor, character, text[index + 1]);
      continue;
    }
    if (character === '"' && cursor.field === "") cursor.isQuoted = true;
    else if (character === delimiter) {
      cursor.row.push(cursor.field);
      cursor.field = "";
    } else if (character === "\n") endRow(cursor);
    else cursor.field += character;
    index += 1;
  }
  if (cursor.field !== "" || cursor.row.length > 0) endRow(cursor);
  return cursor.rows;
}

/**
 * Reads CSV or TSV for the table of a card; the first row is the
 * head.
 * @param source - The text of the block.
 * @param languageHint - `tsv` forces the tab; otherwise the delimiter that
 * splits every line alike is taken: tab, semicolon or comma.
 * @returns The table; rows shorter than the head are filled with empty fields.
 */
export function readCsv(source: string, languageHint: string): CsvTable {
  const lines = source.split("\n").filter((line) => line.trim() !== "");
  const isTab = languageHint.trim().toLowerCase() === "tsv";
  const delimiter = isTab ? "\t" : (findCsvDelimiter(lines) ?? ",");
  const [header = [], ...rows] = splitCsv(source, delimiter);
  const width = Math.max(header.length, ...rows.map((row) => row.length));
  const fill = (row: readonly string[]): string[] =>
    Array.from({ length: width }, (_, column) => row[column] ?? "");
  return { delimiter, header: fill(header), rows: rows.map(fill) };
}

/** The order of a column a person chose by clicking its head. */
export interface CsvSort {
  readonly column: number;
  readonly direction: "ascending" | "descending";
}

const NUMBER = /^-?\d+(?:[.,]\d+)?$/u;

/**
 * Filters and sorts the rows of a table for the search and the column heads.
 * @param rows - The rows below the head.
 * @param options - The search text, which any field may contain regardless of
 * case, and the order; numbers are compared as numbers.
 * @returns The matching rows in the chosen order.
 */
export function selectCsvRows(
  rows: readonly (readonly string[])[],
  options: { readonly query: string; readonly sort: CsvSort | null },
): (readonly string[])[] {
  const query = options.query.trim().toLowerCase();
  const matching = rows.filter(
    (row) =>
      query === "" || row.some((field) => field.toLowerCase().includes(query)),
  );
  const { sort } = options;
  if (sort === null) return matching;
  const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });
  const factor = sort.direction === "ascending" ? 1 : -1;
  return [...matching].sort((first, second) => {
    const left = first[sort.column] ?? "";
    const right = second[sort.column] ?? "";
    if (NUMBER.test(left) && NUMBER.test(right))
      return (
        (Number(left.replace(",", ".")) - Number(right.replace(",", "."))) *
        factor
      );
    return collator.compare(left, right) * factor;
  });
}
