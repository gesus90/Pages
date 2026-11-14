import { ChevronLeft, ChevronRight, PanelLeft } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { SegmentedControl } from "@/app/components/ui/segmented-control";
import { CALENDAR_VIEWS } from "@/definition/Calendar";

import { useCalendarContext } from "./calendar-context";
import { isoWeekNumber } from "./calendar-dates";

import type { CalendarView } from "@/definition/Calendar";
import type { CalendarNavigation } from "./use-calendar-navigation";

interface CalendarHeaderProps {
  readonly view: CalendarView;
  readonly date: string;
  readonly navigation: CalendarNavigation;
  readonly onToggleSidebar: () => void;
}

/**
 * The head of the calendar: month and year, „Heute“, back and forward, the
 * ISO week in the week view and the switch of the views.
 */
export function CalendarHeader({
  view,
  date,
  navigation,
  onToggleSidebar,
}: CalendarHeaderProps): React.ReactElement {
  const { t } = useTranslation();
  const { format } = useCalendarContext();
  const viewOptions = CALENDAR_VIEWS.map((value) => ({
    value,
    label: t(`calendar.views.${value}`),
  }));

  return (
    <header className="flex flex-wrap items-center gap-2 pb-3">
      <Button
        size="icon-sm"
        variant="ghost"
        className="md:hidden"
        aria-label={t("calendar.sidebar.toggle")}
        onClick={onToggleSidebar}
      >
        <PanelLeft className="size-4" aria-hidden="true" />
      </Button>
      <h1 className="mr-2 text-xl font-semibold text-foreground md:text-2xl">
        {format.monthTitle(date)}
      </h1>
      <Button size="xs" variant="outline" onClick={navigation.goToday}>
        {t("calendar.today")}
      </Button>
      <Button
        size="icon-sm"
        variant="outline"
        aria-label={t("calendar.previous")}
        onClick={() => navigation.shift(-1)}
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
      </Button>
      <Button
        size="icon-sm"
        variant="outline"
        aria-label={t("calendar.next")}
        onClick={() => navigation.shift(1)}
      >
        <ChevronRight className="size-4" aria-hidden="true" />
      </Button>
      {view === "week" ? (
        <span className="text-sm text-muted-foreground">
          {t("calendar.week", { number: isoWeekNumber(date) })}
        </span>
      ) : null}
      <SegmentedControl
        className="ml-auto"
        ariaLabel={t("calendar.views.label")}
        value={view}
        options={viewOptions}
        onValueChange={navigation.setView}
      />
    </header>
  );
}
