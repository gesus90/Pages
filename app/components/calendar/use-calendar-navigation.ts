import { useNavigate } from "react-router";

import { shiftAnchor } from "./calendar-dates";

import type { CalendarView } from "@/definition/Calendar";

/** Moves the calendar page through views and dates via its address. */
export interface CalendarNavigation {
  readonly setView: (view: CalendarView) => void;
  readonly setDate: (date: string) => void;
  readonly shift: (direction: 1 | -1) => void;
  readonly goToday: () => void;
  readonly openDay: (date: string) => void;
}

/**
 * Keeps view and anchor date in the address, so a reload or a shared link
 * opens the same range and the loader reads it.
 *
 * @param view - The shown view.
 * @param date - The shown anchor date.
 * @param today - Today in the account's zone.
 */
export function useCalendarNavigation(
  view: CalendarView,
  date: string,
  today: string,
): CalendarNavigation {
  const navigate = useNavigate();

  function goTo(nextView: CalendarView, nextDate: string): void {
    const search = new URLSearchParams({ view: nextView, date: nextDate });
    void navigate(`?${search.toString()}`);
  }

  return {
    setView: (nextView) => goTo(nextView, date),
    setDate: (nextDate) => goTo(view, nextDate),
    shift: (direction) => goTo(view, shiftAnchor(view, date, direction)),
    goToday: () => goTo(view, today),
    openDay: (nextDate) => goTo("day", nextDate),
  };
}
