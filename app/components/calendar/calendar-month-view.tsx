import { useTranslation } from "react-i18next";

import { ScrollViewport } from "@/app/components/ui/scroll-viewport";
import { cn } from "@/app/lib/cn";

import { useCalendarContext } from "./calendar-context";
import { monthGridDates } from "./calendar-dates";
import { CalendarEntryChip } from "./calendar-entry-block";
import { entriesOfDay } from "./calendar-layout";

import type { CalendarViewEntry } from "@/definition/Calendar";

interface CalendarMonthViewProps {
  readonly date: string;
  readonly entries: readonly CalendarViewEntry[];
}

interface MonthCellProps {
  readonly date: string;
  readonly isInMonth: boolean;
  readonly entries: readonly CalendarViewEntry[];
}

/** Entries a day cell shows before „+N weitere“. */
const VISIBLE_ROWS = 3;

/** One day of the month: its number, its first entries and the rest as a link to the day. */
function MonthCell({
  date,
  isInMonth,
  entries,
}: MonthCellProps): React.ReactElement {
  const { t } = useTranslation();
  const { today, openDay, createAt } = useCalendarContext();
  const dayEntries = entriesOfDay(entries, date);
  const hidden = dayEntries.length - VISIBLE_ROWS;
  const visible =
    hidden > 0 ? dayEntries.slice(0, VISIBLE_ROWS - 1) : dayEntries;
  const more = dayEntries.length - visible.length;

  function handleCreate(): void {
    createAt({ date, minute: null });
  }

  function handleOpenDay(event: React.MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    openDay(date);
  }

  return (
    <div
      className="flex min-h-0 min-w-0 cursor-cell flex-col gap-0.5 overflow-hidden border-t border-l border-border p-1.5 [&:nth-child(7n+1)]:border-l-0"
      onClick={handleCreate}
    >
      <button
        type="button"
        className={cn(
          "self-start rounded-full px-1.5 text-xs text-muted-foreground hover:text-foreground",
          !isInMonth && "opacity-50",
          date === today &&
            "bg-primary font-semibold text-primary-foreground hover:text-primary-foreground",
        )}
        onClick={handleOpenDay}
      >
        {Number(date.slice(8, 10))}
      </button>
      {visible.map((entry) => (
        <CalendarEntryChip key={entry.id} entry={entry} />
      ))}
      {more > 0 ? (
        <button
          type="button"
          className="self-start px-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          onClick={handleOpenDay}
        >
          {t("calendar.month.more", { count: more })}
        </button>
      ) : null}
    </div>
  );
}

/**
 * The month view: six weeks of seven days from the Monday before the first.
 * @remarks
 * A week keeps room for its entries and „+N weitere“; in a low panel the six
 * weeks scroll beneath the weekdays instead of clipping the entries.
 */
export function CalendarMonthView({
  date,
  entries,
}: CalendarMonthViewProps): React.ReactElement {
  const { t } = useTranslation();
  const { format } = useCalendarContext();
  const days = monthGridDates(date);
  const month = date.slice(0, 7);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 grid-cols-7 overflow-y-hidden [scrollbar-gutter:stable]">
        {days.slice(0, 7).map((day) => (
          <span
            key={day}
            className="border-l border-border px-2.5 py-1.5 text-xs text-muted-foreground first:border-l-0"
          >
            {format.weekdayShort(day)}
          </span>
        ))}
      </div>
      <ScrollViewport
        aria-label={t("calendar.views.content")}
        className="flex flex-col focus-visible:-outline-offset-2"
        containerClassName="min-h-0 flex-1"
        role="region"
        tabIndex={0}
      >
        <div className="grid flex-1 grid-cols-7 grid-rows-[repeat(6,minmax(6rem,1fr))]">
          {days.map((day) => (
            <MonthCell
              key={day}
              date={day}
              isInMonth={day.startsWith(month)}
              entries={entries}
            />
          ))}
        </div>
      </ScrollViewport>
    </div>
  );
}
