import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { useCalendarContext } from "./calendar-context";
import { CalendarDayColumn } from "./calendar-day-column";
import { CalendarEntryChip } from "./calendar-entry-block";
import { entriesOfDay, firstScrollMinute } from "./calendar-layout";

import type { CalendarViewEntry } from "@/definition/Calendar";
import type { CalendarNow } from "./use-calendar-now";

interface CalendarTimeGridProps {
  readonly dates: readonly string[];
  readonly entries: readonly CalendarViewEntry[];
  readonly now: CalendarNow | null;
}

interface GridRowProps {
  readonly dates: readonly string[];
  readonly entries: readonly CalendarViewEntry[];
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
/** The height of one hour in the grid. */
const HOUR_HEIGHT = "3.5rem";
/** Room above the first entry after the initial scroll, in pixels. */
const SCROLL_MARGIN = 12;

function gridColumns(days: number): React.CSSProperties {
  return { gridTemplateColumns: `3.5rem repeat(${days}, minmax(0, 1fr))` };
}

/** The weekdays above the columns, today in the accent color. */
function DayHeadings({
  dates,
}: Pick<GridRowProps, "dates">): React.ReactElement {
  const { format, today, openDay } = useCalendarContext();

  return (
    <div
      className="grid overflow-y-hidden border-b border-border [scrollbar-gutter:stable]"
      style={gridColumns(dates.length)}
    >
      <span />
      {dates.map((date) => (
        <button
          key={date}
          type="button"
          className={cn(
            "truncate px-2 py-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground",
            date === today && "font-semibold text-primary",
          )}
          onClick={() => openDay(date)}
        >
          {`${format.weekdayShort(date)} ${Number(date.slice(8, 10))}`}
        </button>
      ))}
    </div>
  );
}

/** The row of all-day entries above the hours. */
function AllDayRow({ dates, entries }: GridRowProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div
      className="grid overflow-y-hidden border-b border-border [scrollbar-gutter:stable]"
      style={gridColumns(dates.length)}
    >
      <span className="self-center pr-1 text-[0.6875rem] text-muted-foreground">
        {t("calendar.allDay")}
      </span>
      {dates.map((date) => (
        <ul
          key={date}
          className="flex max-h-20 min-h-8 flex-col gap-0.5 overflow-y-auto p-1"
        >
          {entriesOfDay(entries, date)
            .filter((entry) => entry.allDay)
            .map((entry) => (
              <li key={entry.id}>
                <CalendarEntryChip entry={entry} />
              </li>
            ))}
        </ul>
      ))}
    </div>
  );
}

/** The hour labels on the left of the grid. */
function HourLabels(): React.ReactElement {
  const { format } = useCalendarContext();

  return (
    <div aria-hidden="true">
      {HOURS.map((hour) => (
        <div key={hour} className="relative" style={{ height: HOUR_HEIGHT }}>
          {hour === 0 ? null : (
            <span className="absolute -top-2 right-2 text-[0.6875rem] text-muted-foreground">
              {format.hour(hour)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** Scrolls the grid once per range to the first entry or 08:00. */
function useInitialScroll(
  dates: readonly string[],
  entries: readonly CalendarViewEntry[],
): React.RefObject<HTMLDivElement | null> {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrolledFor = useRef<string | null>(null);
  const rangeKey = dates.join(",");
  const minute = firstScrollMinute(entries, dates);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || scrolledFor.current === rangeKey) return;
    scrolledFor.current = rangeKey;
    const content = element.firstElementChild;
    const height = content instanceof HTMLElement ? content.offsetHeight : 0;
    element.scrollTop = Math.max(0, (minute / 1440) * height - SCROLL_MARGIN);
  }, [rangeKey, minute]);

  return scrollRef;
}

/**
 * The week and the day view: weekday headings, the all-day row and an
 * hour grid from 00:00 to 24:00 that first scrolls to the first entry.
 */
export function CalendarTimeGrid({
  dates,
  entries,
  now,
}: CalendarTimeGridProps): React.ReactElement {
  const scrollRef = useInitialScroll(dates, entries);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DayHeadings dates={dates} />
      <AllDayRow dates={dates} entries={entries} />
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]"
      >
        <div className="relative grid" style={gridColumns(dates.length)}>
          <HourLabels />
          {dates.map((date) => (
            <div key={date} className="relative">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
              >
                {HOURS.map((hour) => (
                  <div
                    key={hour}
                    className="border-t border-border"
                    style={{ height: HOUR_HEIGHT }}
                  />
                ))}
              </div>
              <CalendarDayColumn
                date={date}
                entries={entries}
                nowMinute={
                  now !== null && now.date === date ? now.minute : null
                }
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
