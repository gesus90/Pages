import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import { CalendarMiniMonth } from "./calendar-mini-month";

import type { CalendarColor } from "./calendar-colors";

/** One calendar of the filter list. */
export interface CalendarFilterItem {
  readonly key: string;
  readonly label: string;
  readonly color: CalendarColor;
}

interface CalendarSidebarProps {
  readonly date: string;
  readonly filters: readonly CalendarFilterItem[];
  readonly hidden: ReadonlySet<string>;
  readonly isOpen: boolean;
  readonly onCreate: () => void;
  readonly onSelectDate: (date: string) => void;
  readonly onToggleFilter: (key: string) => void;
}

/** The list „Kalender“: every calendar with its color, each shown or hidden. */
function FilterList({
  filters,
  hidden,
  onToggleFilter,
}: Pick<
  CalendarSidebarProps,
  "filters" | "hidden" | "onToggleFilter"
>): React.ReactElement {
  const { t } = useTranslation();

  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {t("calendar.sidebar.calendars")}
      </h2>
      <ul className="flex flex-col gap-0.5">
        {filters.map((filter) => {
          const isShown = !hidden.has(filter.key);
          return (
            <li key={filter.key}>
              <button
                type="button"
                aria-pressed={isShown}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-1 py-1 text-left text-sm hover:bg-surface-hover",
                  isShown ? "text-foreground" : "text-muted-foreground",
                )}
                onClick={() => onToggleFilter(filter.key)}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-3 shrink-0 rounded-sm",
                    filter.color.dot,
                    !isShown && "opacity-30",
                  )}
                />
                <span className="truncate">{filter.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The left column of the calendar: „+ Termin“, the small month and the
 * calendars; collapsible on narrow screens.
 */
export function CalendarSidebar({
  date,
  filters,
  hidden,
  isOpen,
  onCreate,
  onSelectDate,
  onToggleFilter,
}: CalendarSidebarProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <aside
      className={cn(
        "w-full shrink-0 flex-col gap-5 md:flex md:w-60",
        isOpen ? "flex" : "hidden",
      )}
    >
      <Button className="w-full" onClick={onCreate}>
        <Plus className="size-4" aria-hidden="true" />
        {t("calendar.newEvent")}
      </Button>
      <CalendarMiniMonth
        key={date.slice(0, 7)}
        date={date}
        onSelect={onSelectDate}
      />
      <FilterList
        filters={filters}
        hidden={hidden}
        onToggleFilter={onToggleFilter}
      />
    </aside>
  );
}
