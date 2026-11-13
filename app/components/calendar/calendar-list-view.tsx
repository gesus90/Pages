import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { useCalendarContext } from "./calendar-context";
import { addDays, daysBetween } from "./calendar-dates";
import { CalendarEntryCard } from "./calendar-entry-block";
import { entriesOfDay } from "./calendar-layout";

import type { CalendarViewEntry } from "@/definition/Calendar";

interface CalendarListViewProps {
  readonly from: string;
  readonly to: string;
  readonly entries: readonly CalendarViewEntry[];
}

/** The list view: the entries of the next 30 days, grouped by day. */
export function CalendarListView({
  from,
  to,
  entries,
}: CalendarListViewProps): React.ReactElement {
  const { t } = useTranslation();
  const { format, today } = useCalendarContext();
  const days = Array.from({ length: daysBetween(from, to) + 1 }, (_, index) =>
    addDays(from, index),
  )
    .map((date) => ({ date, dayEntries: entriesOfDay(entries, date) }))
    .filter(({ dayEntries }) => dayEntries.length > 0);

  if (days.length === 0)
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {t("calendar.list.empty")}
      </p>
    );

  return (
    <ol className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pb-4">
      {days.map(({ date, dayEntries }) => (
        <li key={date} className="flex flex-col gap-2">
          <h2
            className={cn(
              "text-sm font-semibold text-foreground",
              date === today && "text-primary",
            )}
          >
            {format.longDate(date)}
          </h2>
          <ul className="flex flex-col gap-1.5">
            {dayEntries.map((entry) => (
              <li key={entry.id}>
                <CalendarEntryCard entry={entry} className="w-full py-2" />
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
