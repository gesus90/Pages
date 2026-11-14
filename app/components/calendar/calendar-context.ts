import { createContext, useContext } from "react";

import type { CalendarViewEntry } from "@/definition/Calendar";
import type { CalendarColor } from "./calendar-colors";
import type { CalendarFormatter } from "./calendar-format";

/** A start the new-event form opens with. */
export interface CalendarDraftStart {
  readonly date: string;
  /** Minutes after midnight, or `null` for the default time. */
  readonly minute: number | null;
}

/** What every view of the calendar page shares. */
export interface CalendarViewContext {
  readonly today: string;
  readonly format: CalendarFormatter;
  readonly colorOf: (entry: CalendarViewEntry) => CalendarColor;
  readonly openEntry: (entry: CalendarViewEntry) => void;
  readonly createAt: (start: CalendarDraftStart) => void;
  readonly openDay: (date: string) => void;
}

const CalendarContext = createContext<CalendarViewContext | null>(null);

/** Provides the shared state of the calendar page to its views. */
export const CalendarContextProvider = CalendarContext.Provider;

/**
 * Reads the shared state of the calendar page.
 *
 * @throws Error - Outside the calendar page.
 */
export function useCalendarContext(): CalendarViewContext {
  const context = useContext(CalendarContext);
  if (!context) throw new Error("The calendar views need the calendar page.");
  return context;
}
