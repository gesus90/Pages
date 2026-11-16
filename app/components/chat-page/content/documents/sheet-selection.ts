import type { SheetCell } from "./document-model";

/** A cell of the shown table: its row among the shown rows and its column. */
export interface CellPosition {
  readonly row: number;
  readonly column: number;
}

/** The marked cells: from the cell clicked first to the cell the mark ends at. */
export interface CellSelection {
  readonly anchor: CellPosition;
  readonly focus: CellPosition;
}

/** The sum, count and mean of the numbers among the marked cells. */
export interface SelectionSummary {
  /** Marked cells, numbers or not. */
  readonly cellCount: number;
  /** Marked cells that hold a number. */
  readonly numberCount: number;
  readonly sum: number;
  /** `null` without a number. */
  readonly mean: number | null;
}

/** A shown row: its number in the sheet, counted from 1, and its cells. */
export interface ShownRow {
  readonly number: number;
  readonly cells: readonly SheetCell[];
}

/** The order of a column a person chose by clicking its head. */
export interface SheetSort {
  readonly column: number;
  readonly direction: "ascending" | "descending";
}

/**
 * Whether a cell lies inside the marked rectangle.
 * @param selection - The mark, or `null`.
 * @param position - The cell.
 */
export function isSelected(
  selection: CellSelection | null,
  position: CellPosition,
): boolean {
  if (!selection) return false;
  const { anchor, focus } = selection;
  return (
    position.row >= Math.min(anchor.row, focus.row) &&
    position.row <= Math.max(anchor.row, focus.row) &&
    position.column >= Math.min(anchor.column, focus.column) &&
    position.column <= Math.max(anchor.column, focus.column)
  );
}

/**
 * Adds up the numbers of the marked cells, as the foot of a table shows them.
 * Only stored values count; nothing is recalculated.
 * @param rows - The shown rows.
 * @param selection - The mark, or `null`.
 */
export function summarizeSelection(
  rows: readonly ShownRow[],
  selection: CellSelection | null,
): SelectionSummary {
  if (!selection) return { cellCount: 0, numberCount: 0, sum: 0, mean: null };
  const summary = { cellCount: 0, numberCount: 0, sum: 0 };
  const top = Math.min(selection.anchor.row, selection.focus.row);
  const bottom = Math.max(selection.anchor.row, selection.focus.row);
  const left = Math.min(selection.anchor.column, selection.focus.column);
  const right = Math.max(selection.anchor.column, selection.focus.column);
  for (const row of rows.slice(top, bottom + 1)) {
    for (const cell of row.cells.slice(left, right + 1)) {
      summary.cellCount += 1;
      if (cell.number === null) continue;
      summary.numberCount += 1;
      summary.sum += cell.number;
    }
  }
  return {
    ...summary,
    mean: summary.numberCount === 0 ? null : summary.sum / summary.numberCount,
  };
}

/**
 * Filters and sorts the rows of a sheet below its head for the search and
 * the column heads; each row keeps its number in the sheet.
 * @param rows - The rows below the head.
 * @param options - The search, which any cell may contain regardless of case,
 * the order, and the number of the first row.
 */
export function selectSheetRows(
  rows: readonly (readonly SheetCell[])[],
  options: {
    readonly query: string;
    readonly sort: SheetSort | null;
    readonly firstNumber: number;
  },
): ShownRow[] {
  const query = options.query.trim().toLocaleLowerCase();
  const shown = rows
    .map((cells, index) => ({ number: options.firstNumber + index, cells }))
    .filter(
      ({ cells }) =>
        query === "" ||
        cells.some((cell) => cell.text.toLocaleLowerCase().includes(query)),
    );
  const { sort } = options;
  if (sort === null) return shown;
  const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });
  const factor = sort.direction === "ascending" ? 1 : -1;
  return shown.sort((first, second) => {
    const left = first.cells[sort.column] ?? { text: "", number: null };
    const right = second.cells[sort.column] ?? { text: "", number: null };
    if (left.number !== null && right.number !== null)
      return (left.number - right.number) * factor;
    // Numbers come before text, empty cells last, in both directions.
    if (left.text === "" || right.text === "")
      return Number(left.text === "") - Number(right.text === "");
    if (left.number !== null || right.number !== null)
      return (left.number === null ? 1 : -1) * factor;
    return collator.compare(left.text, right.text) * factor;
  });
}

/** The next order of a column: ascending, descending, then as written. */
export function nextSheetSort(
  current: SheetSort | null,
  column: number,
): SheetSort | null {
  if (current?.column !== column) return { column, direction: "ascending" };
  return current.direction === "ascending"
    ? { column, direction: "descending" }
    : null;
}
