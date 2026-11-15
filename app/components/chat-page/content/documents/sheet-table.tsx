import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { MarkedText } from "./document-text";
import { isSelected } from "./sheet-selection";
import { columnLetters } from "./sheet-reader";

import type { SheetCell } from "./document-model";
import type {
  CellPosition,
  CellSelection,
  SheetSort,
  ShownRow,
} from "./sheet-selection";

/** Props of the grid of one sheet. */
export interface SheetTableProps {
  /** The first row of the sheet, shown below the column letters as the head. */
  readonly head: readonly SheetCell[];
  readonly rows: readonly ShownRow[];
  readonly columnCount: number;
  readonly query?: string;
  /** Offers sorting by a click on a column head. */
  readonly sort?: SheetSort | null;
  readonly onSort?: (column: number) => void;
  /** Offers marking cells; the foot shows their sum. */
  readonly selection?: CellSelection | null;
  readonly onSelect?: (position: CellPosition, isExtending: boolean) => void;
  /** Keeps the head at the top while the rows scroll. */
  readonly isHeadFixed?: boolean;
  readonly className?: string;
}

function SortIcon({
  sort,
  column,
}: {
  readonly sort: SheetSort | null | undefined;
  readonly column: number;
}): React.ReactElement {
  if (sort?.column !== column)
    return <ArrowUpDown aria-hidden="true" className="size-3 opacity-40" />;
  const Icon = sort.direction === "ascending" ? ArrowUp : ArrowDown;
  return <Icon aria-hidden="true" className="size-3 text-primary" />;
}

interface HeadCellProps {
  readonly column: number;
  readonly cell: SheetCell | undefined;
  readonly sort?: SheetSort | null;
  readonly onSort?: (column: number) => void;
  readonly isHeadFixed: boolean;
}

/** A column head: the letters of the column and below them the text of the first row. */
function HeadCell({
  column,
  cell,
  sort,
  onSort,
  isHeadFixed,
}: HeadCellProps): React.ReactElement {
  const { t } = useTranslation();
  const letters = columnLetters(column);
  const label = (
    <span className="flex min-w-0 flex-col items-start leading-tight">
      <span className="text-[10px] font-normal text-muted-foreground">
        {letters}
      </span>
      <span className="max-w-64 truncate">{cell?.text ?? ""}</span>
    </span>
  );
  const ariaSort = sort?.column === column ? sort.direction : undefined;
  return (
    <th
      aria-sort={ariaSort}
      className={cn(
        "border-r border-b border-border bg-panel-body px-2 py-1 text-left font-semibold whitespace-nowrap",
        isHeadFixed && "sticky top-0 z-10",
      )}
      scope="col"
    >
      {onSort ? (
        <button
          aria-label={t("chatPage.cards.sheet.sortBy", {
            column:
              cell?.text !== undefined && cell.text !== ""
                ? cell.text
                : letters,
          })}
          className="flex w-full items-center justify-between gap-2 focus-visible:outline-2 focus-visible:outline-primary"
          onClick={() => onSort(column)}
          type="button"
        >
          {label}
          <SortIcon column={column} sort={sort} />
        </button>
      ) : (
        label
      )}
    </th>
  );
}

/**
 * The grid of a sheet (PAGE-385): row numbers, column letters with the first
 * row as head, numbers right aligned, and optionally sorting, a fixed head and
 * marked cells. Cells are text; nothing of the file runs.
 */
export function SheetTable({
  head,
  rows,
  columnCount,
  query = "",
  sort,
  onSort,
  selection = null,
  onSelect,
  isHeadFixed = false,
  className,
}: SheetTableProps): React.ReactElement {
  const columns = Array.from({ length: columnCount }, (_, column) => column);
  return (
    <table
      className={cn(
        "border-separate border-spacing-0 text-xs tabular-nums",
        className,
      )}
      data-sheet-table=""
    >
      <thead>
        <tr>
          <th
            aria-hidden="true"
            className={cn(
              "sticky left-0 z-20 w-10 border-r border-b border-border bg-panel-body",
              isHeadFixed && "top-0",
            )}
          />
          {columns.map((column) => (
            <HeadCell
              key={column}
              cell={head[column]}
              column={column}
              isHeadFixed={isHeadFixed}
              onSort={onSort}
              sort={sort}
            />
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={row.number}>
            <th
              className="sticky left-0 border-r border-b border-border bg-panel-body px-2 py-1 text-right font-normal text-muted-foreground"
              scope="row"
            >
              {row.number}
            </th>
            {columns.map((column) => {
              const cell = row.cells[column];
              const position = { row: rowIndex, column };
              const isMarked = isSelected(selection, position);
              return (
                <td
                  key={column}
                  aria-selected={onSelect ? isMarked : undefined}
                  className={cn(
                    "max-w-80 truncate border-r border-b border-border px-2 py-1 whitespace-pre",
                    cell?.number !== null &&
                      cell?.number !== undefined &&
                      "text-right",
                    onSelect && "cursor-cell select-none",
                    isMarked && "bg-primary-subtle",
                  )}
                  onMouseDown={(event) => onSelect?.(position, event.shiftKey)}
                  onMouseEnter={(event) => {
                    if (event.buttons === 1) onSelect?.(position, true);
                  }}
                  title={cell?.text}
                >
                  <MarkedText query={query} text={cell?.text ?? ""} />
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface SheetTabsProps {
  readonly names: readonly string[];
  readonly active: number;
  readonly onSelect: (index: number) => void;
  readonly className?: string;
}

/** The tabs of the sheets of a workbook; a single CSV table has one. */
export function SheetTabs({
  names,
  active,
  onSelect,
  className,
}: SheetTabsProps): React.ReactElement | null {
  const { t } = useTranslation();
  return (
    <div
      aria-label={t("chatPage.cards.sheet.sheets")}
      className={cn("flex gap-1 overflow-x-auto", className)}
      role="tablist"
    >
      {names.map((name, index) => (
        <button
          key={`${name}-${String(index)}`}
          aria-selected={index === active}
          className={cn(
            "shrink-0 rounded-md px-2.5 py-1 text-xs font-medium focus-visible:outline-2 focus-visible:outline-primary",
            index === active
              ? "bg-primary-subtle text-primary"
              : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
          )}
          onClick={() => onSelect(index)}
          role="tab"
          type="button"
        >
          {name}
        </button>
      ))}
    </div>
  );
}
