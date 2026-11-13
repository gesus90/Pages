import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { useCalendarContext } from "./calendar-context";
import { addMonths, monthGridDates, startOfWeek } from "./calendar-dates";

interface CalendarMiniMonthProps {
  /** The anchor date of the page; its week is highlighted. */
  readonly date: string;
  readonly onSelect: (date: string) => void;
}

/**
 * The small month on the left to jump to a date; the week of the shown
 * date is highlighted and today takes the accent color.
 */
export function CalendarMiniMonth({
  date,
  onSelect,
}: CalendarMiniMonthProps): React.ReactElement {
  const { t } = useTranslation();
  const { format, today } = useCalendarContext();
  const [month, setMonth] = useState(`${date.slice(0, 7)}-01`);
  const days = monthGridDates(month);
  const selectedWeek = startOfWeek(date);

  return (
    <section className="rounded-xl bg-surface p-3 shadow-card">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          {format.monthTitle(month)}
        </h2>
        <div className="flex">
          <button
            type="button"
            className="rounded p-1 text-muted-foreground hover:text-foreground"
            aria-label={t("calendar.miniMonth.previous")}
            onClick={() => setMonth(addMonths(month, -1))}
          >
            <ChevronLeft className="size-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="rounded p-1 text-muted-foreground hover:text-foreground"
            aria-label={t("calendar.miniMonth.next")}
            onClick={() => setMonth(addMonths(month, 1))}
          >
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-y-0.5 text-center text-xs">
        {days.slice(0, 7).map((day) => (
          <span
            key={day}
            className="py-1 text-[0.6875rem] text-muted-foreground"
          >
            {format.weekdayShort(day)}
          </span>
        ))}
        {days.map((day) => (
          <button
            key={day}
            type="button"
            aria-label={format.longDate(day)}
            aria-current={day === today ? "date" : undefined}
            className={cn(
              "rounded-md py-1 text-foreground hover:bg-surface-hover",
              !day.startsWith(month.slice(0, 7)) &&
                "text-muted-foreground opacity-50",
              startOfWeek(day) === selectedWeek && "bg-muted",
              day === today &&
                "bg-primary font-semibold text-primary-foreground opacity-100 hover:bg-primary-hover",
            )}
            onClick={() => onSelect(day)}
          >
            {Number(day.slice(8, 10))}
          </button>
        ))}
      </div>
    </section>
  );
}
