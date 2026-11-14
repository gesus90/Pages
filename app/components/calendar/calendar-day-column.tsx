import { useCalendarContext } from "./calendar-context";
import { CalendarEntryCard } from "./calendar-entry-block";
import { layoutDay } from "./calendar-layout";

import type { CalendarViewEntry } from "@/definition/Calendar";

interface CalendarDayColumnProps {
  readonly date: string;
  readonly entries: readonly CalendarViewEntry[];
  /** Minutes after midnight of now when the column is today, else `null`. */
  readonly nowMinute: number | null;
}

const MINUTES_PER_DAY = 1440;
/** A click into the grid starts a new event on the half hour. */
const SNAP_MINUTES = 30;
/** Gap between entries side by side, in percent of the column. */
const COLUMN_GAP = 2;

function percentOf(minute: number): string {
  return `${(minute / MINUTES_PER_DAY) * 100}%`;
}

/**
 * One day of the week or day view: the timed entries side by side where
 * they overlap, the line of the current time on today, and a click into
 * free time to start a new event there.
 */
export function CalendarDayColumn({
  date,
  entries,
  nowMinute,
}: CalendarDayColumnProps): React.ReactElement {
  const { createAt } = useCalendarContext();
  const placed = layoutDay(entries, date);

  function handleClick(event: React.MouseEvent<HTMLDivElement>): void {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.height <= 0) return;
    const ratio = (event.clientY - bounds.top) / bounds.height;
    const minute =
      Math.floor((ratio * MINUTES_PER_DAY) / SNAP_MINUTES) * SNAP_MINUTES;
    createAt({
      date,
      minute: Math.min(Math.max(minute, 0), MINUTES_PER_DAY - 60),
    });
  }

  return (
    <div
      className="absolute inset-0 cursor-cell border-l border-border"
      onClick={handleClick}
    >
      {placed.map((block) => {
        const width = 100 / block.columns;
        return (
          <CalendarEntryCard
            key={block.entry.id}
            entry={block.entry}
            className="absolute"
            style={{
              top: percentOf(block.startMinute),
              height: `calc(${percentOf(block.endMinute - block.startMinute)} - 2px)`,
              left: `calc(${block.column * width}% + ${COLUMN_GAP}px)`,
              width: `calc(${width}% - ${COLUMN_GAP * 2}px)`,
            }}
          />
        );
      })}
      {nowMinute === null ? null : (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-calendar-now"
          style={{ top: percentOf(nowMinute) }}
        >
          <span className="absolute -top-1 -left-1 size-2.5 rounded-full bg-calendar-now" />
        </div>
      )}
    </div>
  );
}
