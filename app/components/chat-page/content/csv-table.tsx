import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { readCsv, selectCsvRows } from "./csv-parse";

import type { CsvSort } from "./csv-parse";

/** Rows of one page of a large table. */
const PAGE_ROWS = 100;

const DELIMITER_KEYS: Readonly<Record<string, string>> = {
  ",": "comma",
  ";": "semicolon",
  "\t": "tab",
};

/** The next order of a column: ascending, descending, then as written. */
function nextSort(current: CsvSort | null, column: number): CsvSort | null {
  if (current?.column !== column) return { column, direction: "ascending" };
  return current.direction === "ascending"
    ? { column, direction: "descending" }
    : null;
}

function SortIcon({
  sort,
  column,
}: {
  readonly sort: CsvSort | null;
  readonly column: number;
}): React.ReactElement {
  if (sort?.column !== column)
    return <ArrowUpDown aria-hidden="true" className="size-3 opacity-40" />;
  const Icon = sort.direction === "ascending" ? ArrowUp : ArrowDown;
  return <Icon aria-hidden="true" className="size-3 text-primary" />;
}

interface CsvPagerProps {
  readonly page: number;
  readonly pageCount: number;
  readonly onPage: (page: number) => void;
}

/** "Zurück · Seite 2 / 5 · Weiter" below a table of more than 100 rows. */
function CsvPager({
  page,
  pageCount,
  onPage,
}: CsvPagerProps): React.ReactElement | null {
  const { t } = useTranslation();
  if (pageCount < 2) return null;
  const buttonClass =
    "rounded-md border border-border bg-surface px-2 py-0.5 hover:bg-surface-hover disabled:opacity-40";
  return (
    <nav
      aria-label={t("chatPage.preview.csv.pages")}
      className="flex items-center justify-end gap-2 border-t border-border px-3 py-1.5 text-xs text-muted-foreground"
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
        {t("chatPage.preview.csv.page", {
          page: page + 1,
          count: pageCount,
        })}
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

interface CsvTableViewProps {
  readonly source: string;
  /** `csv` or `tsv`; `tsv` forces the tab as delimiter. */
  readonly languageHint: string;
  readonly className?: string;
}

/**
 * CSV or TSV as a table (PAGE-383): the first row as head, columns sorted by
 * a click on their head, a search over every field, the recognized
 * delimiter, and 100 rows per page in a scrolling frame. Nothing of the
 * text is executed.
 */
export function CsvTableView({
  source,
  languageHint,
  className,
}: CsvTableViewProps): React.ReactElement {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<CsvSort | null>(null);
  const [page, setPage] = useState(0);
  const table = readCsv(source, languageHint);
  const rows = selectCsvRows(table.rows, { query, sort });
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_ROWS));
  const shownPage = Math.min(page, pageCount - 1);
  const shown = rows.slice(shownPage * PAGE_ROWS, (shownPage + 1) * PAGE_ROWS);

  function handleSort(column: number): void {
    setSort(nextSort(sort, column));
    setPage(0);
  }

  return (
    <div className={cn("flex min-h-0 flex-col bg-panel-body", className)}>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
        <label className="flex h-7 min-w-40 flex-1 items-center gap-1.5 rounded-md border border-field-border bg-field px-2">
          <Search aria-hidden="true" className="size-3.5" />
          <input
            aria-label={t("chatPage.preview.csv.search")}
            className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-placeholder-foreground"
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            placeholder={t("chatPage.preview.csv.search")}
            type="search"
            value={query}
          />
        </label>
        <span>
          {t("chatPage.preview.csv.rows", { count: rows.length })} ·{" "}
          {t(`chatPage.preview.csv.delimiter.${DELIMITER_KEYS[table.delimiter] ?? "comma"}`)}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="pages-selectable w-max min-w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-muted">
            <tr>
              {table.header.map((title, column) => (
                <th
                  key={column}
                  aria-sort={
                    sort?.column === column ? sort.direction : undefined
                  }
                  className="border-b border-border px-3 py-1.5 text-left font-semibold whitespace-nowrap"
                  scope="col"
                >
                  <button
                    className="inline-flex items-center gap-1 hover:text-primary"
                    onClick={() => handleSort(column)}
                    type="button"
                  >
                    {title}
                    <SortIcon column={column} sort={sort} />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, index) => (
              <tr key={index} className="even:bg-muted/50">
                {row.map((field, column) => (
                  <td
                    key={column}
                    className="border-b border-border px-3 py-1 whitespace-nowrap"
                  >
                    {field}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted-foreground" role="status">
            {t("chatPage.preview.csv.noMatch")}
          </p>
        ) : null}
      </div>
      <CsvPager onPage={setPage} page={shownPage} pageCount={pageCount} />
    </div>
  );
}
