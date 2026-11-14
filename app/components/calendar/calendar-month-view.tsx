import { useTranslation } from "react-i18next";

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
      className="flex min-h-0 min-w-0 cursor-cell flex-col gap-0.5 overflow-hidden border-t border-l border-border p-1.5"
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

/** The month view: six weeks of seven days from the Monday before the first. */
export function CalendarMonthView({
  date,
  entries,
}: CalendarMonthViewProps): React.ReactElement {
  const { format } = useCalendarContext();
  const days = monthGridDates(date);
  const month = date.slice(0, 7);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-r border-b border-border">
      <div className="grid grid-cols-7">
        {days.slice(0, 7).map((day) => (
          <span
            key={day}
            className="border-t border-l border-border px-2.5 py-1.5 text-xs text-muted-foreground"
          >
            {format.weekdayShort(day)}
          </span>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {days.map((day) => (
          <MonthCell
            key={day}
            date={day}
            isInMonth={day.startsWith(month)}
            entries={entries}
          />
        ))}
      </div>
    </div>
  );
}
