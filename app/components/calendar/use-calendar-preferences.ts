import { useEffect, useState } from "react";

import { readCalendarView } from "./calendar-dates";

import type { CalendarView } from "@/definition/Calendar";

/** What the calendar page keeps per account in the browser. */
export interface CalendarPreferences {
  readonly view: CalendarView | null;
  /** Filter keys of the hidden calendars. */
  readonly hidden: readonly string[];
}

/** The hidden calendars of the page and how to toggle one. */
export interface CalendarVisibility {
  readonly hidden: ReadonlySet<string>;
  readonly toggle: (key: string) => void;
}

const EMPTY_PREFERENCES: CalendarPreferences = { view: null, hidden: [] };

function storageKey(userId: string): string {
  return `pages.calendar.${userId}`;
}

function parsePreferences(text: string | null): CalendarPreferences {
  if (text === null) return EMPTY_PREFERENCES;
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null) return EMPTY_PREFERENCES;
  const view =
    "view" in parsed && typeof parsed.view === "string"
      ? readCalendarView(parsed.view)
      : null;
  const hidden =
    "hidden" in parsed && Array.isArray(parsed.hidden)
      ? parsed.hidden.filter((key): key is string => typeof key === "string")
      : [];
  return { view, hidden };
}

/**
 * Reads the kept view and hidden calendars of an account.
 *
 * @remarks
 * Only in the browser; storage that is blocked or holds something else
 * reads as no preferences.
 *
 * @param userId - The signed-in account.
 */
export function readCalendarPreferences(userId: string): CalendarPreferences {
  try {
    return parsePreferences(window.localStorage.getItem(storageKey(userId)));
  } catch (error: unknown) {
    console.warn("Pages could not read the calendar preferences.", error);
    return EMPTY_PREFERENCES;
  }
}

/**
 * Keeps a change of the view or of the hidden calendars of an account.
 *
 * @param userId - The signed-in account.
 * @param change - The fields that change.
 */
export function writeCalendarPreferences(
  userId: string,
  change: Partial<CalendarPreferences>,
): void {
  const next = { ...readCalendarPreferences(userId), ...change };
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(next));
  } catch (error: unknown) {
    console.warn("Pages could not keep the calendar preferences.", error);
  }
}

/**
 * Keeps the shown view and reads and toggles the hidden calendars of an account.
 *
 * @remarks
 * The server renders all calendars; the kept choice applies right after
 * hydration, since only the browser knows it.
 *
 * @param userId - The signed-in account.
 * @param view - The view the page shows.
 */
export function useCalendarPreferences(
  userId: string,
  view: CalendarView,
): CalendarVisibility {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    setHidden(new Set(readCalendarPreferences(userId).hidden));
  }, [userId]);

  useEffect(() => {
    writeCalendarPreferences(userId, { view });
  }, [userId, view]);

  function toggle(key: string): void {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setHidden(next);
    writeCalendarPreferences(userId, { hidden: [...next] });
  }

  return { hidden, toggle };
}
