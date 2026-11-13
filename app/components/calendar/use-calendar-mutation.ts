import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";

import { isCalendarActionData } from "./calendar-page-data";

import type {
  CalendarPageActionData,
  CalendarPageError,
  CalendarPageIntent,
} from "./calendar-page-data";

/** A change of the calendar page in flight and its outcome. */
export interface CalendarMutation {
  /** Sends a change; `fields` become form fields beside `intent`. */
  readonly submit: (
    intent: CalendarPageIntent,
    fields: Readonly<Record<string, string>>,
  ) => void;
  readonly isPending: boolean;
  /** The reason the last change failed, or `null`. */
  readonly error: CalendarPageError | null;
  /** The last answer, for intents that answer with data. */
  readonly result: CalendarPageActionData | null;
}

/**
 * Sends changes of the calendar page through its action.
 *
 * @param onSuccess - Called once per successful change.
 */
export function useCalendarMutation(
  onSuccess?: (result: CalendarPageActionData) => void,
): CalendarMutation {
  const fetcher = useFetcher();
  const handled = useRef<unknown>(null);
  const answer: unknown = fetcher.data;
  const result = isCalendarActionData(answer) ? answer : null;
  const isIdle = fetcher.state === "idle";

  useEffect(() => {
    if (!isIdle || result === null || handled.current === result) return;
    handled.current = result;
    if (result.ok) onSuccess?.(result);
  }, [isIdle, result, onSuccess]);

  function submit(
    intent: CalendarPageIntent,
    fields: Readonly<Record<string, string>>,
  ): void {
    const formData = new FormData();
    formData.set("intent", intent);
    for (const [key, value] of Object.entries(fields)) formData.set(key, value);
    void fetcher.submit(formData, { method: "post", action: "/kalender" });
  }

  return {
    submit,
    isPending: !isIdle,
    error: isIdle && result !== null && !result.ok ? result.error : null,
    result,
  };
}
