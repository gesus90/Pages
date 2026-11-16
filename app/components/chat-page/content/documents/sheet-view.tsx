import { useState } from "react";
import { useTranslation } from "react-i18next";

import { DocumentSearch } from "./document-search";
import {
  nextSheetSort,
  selectSheetRows,
  summarizeSelection,
} from "./sheet-selection";
import { SheetTable, SheetTabs } from "./sheet-table";

import type { Sheet, SheetDocument } from "./document-model";
import type {
  CellPosition,
  CellSelection,
  SheetSort,
  ShownRow,
} from "./sheet-selection";

/** Rows the card shows below the head. */
export const SHEET_PREVIEW_ROWS = 8;
/** Rows of one page of the whole table. */
export const SHEET_PAGE_ROWS = 200;
/** Columns the card shows; the whole table shows every one. */
const SHEET_PREVIEW_COLUMNS = 12;

const DELIMITER_KEYS: Readonly<Record<string, string>> = {
  ",": "comma",
  ";": "semicolon",
  "\t": "tab",
};

/** The rows of a sheet below its head, each with its number in the sheet. */
function bodyRows(sheet: Sheet): ShownRow[] {
  return sheet.rows
    .slice(1)
    .map((cells, index) => ({ number: index + 2, cells }));
}

/** The number of rows below the head of a sheet. */
export function sheetRowCount(sheet: Sheet | undefined): number {
  return sheet ? Math.max(0, sheet.rows.length - 1) : 0;
}

interface SheetPreviewProps {
  readonly document: SheetDocument;
  /** Opens the whole table next to the chat. */
  readonly onOpen: () => void;
}

/**
 * The table of a card: tabs for the sheets, row numbers, column
 * letters with the first row as head, numbers right aligned, the first rows
 * and "N von M Zeilen · Ganze Tabelle öffnen".
 */
export function SheetPreview({
  document,
  onOpen,
}: SheetPreviewProps): React.ReactElement {
  const { t } = useTranslation();
  const [active, setActive] = useState(0);
  const sheet = document.sheets[active] ?? document.sheets[0];
  const total = sheetRowCount(sheet);
  const shown = Math.min(total, SHEET_PREVIEW_ROWS);
  return (
    <div className="flex flex-col">
      {document.sheets.length > 1 ? (
        <SheetTabs
          active={active}
          className="border-b border-border px-3 py-1.5"
          names={document.sheets.map(({ name }) => name)}
          onSelect={setActive}
        />
      ) : null}
      {sheet && sheet.columnCount > 0 ? (
        <div className="max-h-80 overflow-auto">
          <SheetTable
            columnCount={Math.min(sheet.columnCount, SHEET_PREVIEW_COLUMNS)}
            head={sheet.rows[0] ?? []}
            rows={bodyRows(sheet).slice(0, SHEET_PREVIEW_ROWS)}
          />
        </div>
      ) : (
        <p className="px-3 py-4 text-sm text-muted-foreground">
          {t("chatPage.cards.sheet.empty")}
        </p>
      )}
      <p className="flex flex-wrap items-center gap-x-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
        <span>{t("chatPage.cards.sheet.rowsOf", { shown, count: total })}</span>
        <span aria-hidden="true">·</span>
        <button
          className="font-medium text-primary hover:underline"
          onClick={onOpen}
          type="button"
        >
          {t("chatPage.cards.sheet.openWhole")}
        </button>
      </p>
    </div>
  );
}

/** Sum, count and mean of the marked cells, or how to mark them. */
function SelectionFoot({
  rows,
  selection,
}: {
  readonly rows: readonly ShownRow[];
  readonly selection: CellSelection | null;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const summary = summarizeSelection(rows, selection);
  const format = new Intl.NumberFormat(i18n.language, {
    maximumFractionDigits: 6,
  });
  if (summary.cellCount === 0)
    return <span>{t("chatPage.cards.sheet.selectHint")}</span>;
  return (
    <span data-sheet-summary="">
      {t("chatPage.cards.sheet.summary", {
        sum: format.format(summary.sum),
        count: summary.cellCount,
        numbers: summary.numberCount,
      })}
      {summary.mean === null
        ? null
        : ` · ${t("chatPage.cards.sheet.mean", { mean: format.format(summary.mean) })}`}
    </span>
  );
}

interface SheetPagerProps {
  readonly page: number;
  readonly pageCount: number;
  readonly onPage: (page: number) => void;
}

function SheetPager({
  page,
  pageCount,
  onPage,
}: SheetPagerProps): React.ReactElement | null {
  const { t } = useTranslation();
  if (pageCount < 2) return null;
  const buttonClass =
    "rounded-md border border-border bg-surface px-2 py-0.5 hover:bg-surface-hover disabled:opacity-40";
  return (
    <nav
      aria-label={t("chatPage.cards.sheet.pages")}
      className="flex items-center gap-2"
    >
      <button
        className={buttonClass}
        disabled={page === 0}
        onClick={() => onPage(page - 1)}
        type="button"
      >
        {t("chatPage.preview.csv.previous")}
      </button>
      <span>
        {t("chatPage.preview.csv.page", { page: page + 1, count: pageCount })}
      </span>
      <button
        className={buttonClass}
        disabled={page >= pageCount - 1}
        onClick={() => onPage(page + 1)}
        type="button"
      >
        {t("chatPage.preview.csv.next")}
      </button>
    </nav>
  );
}

/** The search, sorting, mark and page of the whole table; each resets what depends on it. */
function useSheetView(): {
  readonly active: number;
  readonly query: string;
  readonly sort: SheetSort | null;
  readonly selection: CellSelection | null;
  readonly page: number;
  readonly selectSheet: (index: number) => void;
  readonly search: (query: string) => void;
  readonly sortBy: (column: number) => void;
  readonly select: (position: CellPosition, isExtending: boolean) => void;
  readonly turn: (page: number) => void;
} {
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SheetSort | null>(null);
  const [selection, setSelection] = useState<CellSelection | null>(null);
  const [page, setPage] = useState(0);
  return {
    active,
    query,
    sort,
    selection,
    page,
    selectSheet(index) {
      setActive(index);
      setSort(null);
      setSelection(null);
      setPage(0);
    },
    search(next) {
      setQuery(next);
      setSelection(null);
      setPage(0);
    },
    sortBy(column) {
      setSort((current) => nextSheetSort(current, column));
      setSelection(null);
    },
    select(position, isExtending) {
      setSelection((current) =>
        isExtending && current
          ? { ...current, focus: position }
          : { anchor: position, focus: position },
      );
    },
    turn(next) {
      setPage(next);
      setSelection(null);
    },
  };
}

interface SheetPanelProps {
  readonly document: SheetDocument;
}

/**
 * The whole table next to the chat and in the full screen: tabs
 * for the sheets, a search, sorting by a click on a column head, a fixed
 * head, marked cells with their sum in the foot, and 200 rows per page.
 * Formulas show their stored values; nothing is recalculated.
 */
export function SheetPanel({ document }: SheetPanelProps): React.ReactElement {
  const { t } = useTranslation();
  const view = useSheetView();
  const sheet = document.sheets[view.active] ?? document.sheets[0];
  const all = sheet ? sheet.rows.slice(1) : [];
  const rows = selectSheetRows(all, {
    query: view.query,
    sort: view.sort,
    firstNumber: 2,
  });
  const pageCount = Math.max(1, Math.ceil(rows.length / SHEET_PAGE_ROWS));
  const page = Math.min(view.page, pageCount - 1);
  const pageRows = rows.slice(
    page * SHEET_PAGE_ROWS,
    (page + 1) * SHEET_PAGE_ROWS,
  );
  const delimiterKey =
    document.delimiter === null
      ? undefined
      : DELIMITER_KEYS[document.delimiter];
  return (
    <div
      className="flex min-h-0 flex-1 flex-col bg-surface text-foreground"
      data-sheet-panel=""
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-1.5">
        <SheetTabs
          active={view.active}
          className="min-w-0 flex-1"
          names={document.sheets.map(({ name }) => name)}
          onSelect={view.selectSheet}
        />
        <DocumentSearch
          className="w-64 max-w-full"
          matchCount={view.query.trim() === "" ? null : rows.length}
          onQuery={view.search}
          query={view.query}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {sheet && sheet.columnCount > 0 ? (
          <SheetTable
            columnCount={sheet.columnCount}
            head={sheet.rows[0] ?? []}
            isHeadFixed
            onSelect={view.select}
            onSort={view.sortBy}
            query={view.query}
            rows={pageRows}
            selection={view.selection}
            sort={view.sort}
          />
        ) : (
          <p className="p-4 text-sm text-muted-foreground">
            {t("chatPage.cards.sheet.empty")}
          </p>
        )}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-panel-body px-3 py-1.5 text-xs text-muted-foreground">
        <SelectionFoot rows={pageRows} selection={view.selection} />
        <span className="flex flex-wrap items-center gap-3">
          {delimiterKey ? (
            <span>{t(`chatPage.preview.csv.delimiter.${delimiterKey}`)}</span>
          ) : null}
          {sheet?.isTruncated ? (
            <span>{t("chatPage.cards.sheet.truncated")}</span>
          ) : null}
          <span>{t("chatPage.cards.sheet.rows", { count: rows.length })}</span>
          <SheetPager onPage={view.turn} page={page} pageCount={pageCount} />
        </span>
      </footer>
    </div>
  );
}
