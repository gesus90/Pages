import type {
  CalendarInviteeKind,
  CalendarTarget,
  CalendarView,
  CalendarViewEntry,
} from "@/definition/Calendar";

/** A project of the signed-in account, for the filter list. */
export interface CalendarPageProject {
  readonly id: string;
  readonly name: string;
}

/** What the calendar page loads for the visible range (PAGE-301). */
export interface CalendarPageData {
  /** The account the view preferences are kept for. */
  readonly userId: string;
  readonly view: CalendarView;
  /** The anchor date of the view, `YYYY-MM-DD`. */
  readonly date: string;
  /** Today in the account's time zone, `YYYY-MM-DD`. */
  readonly today: string;
  /** First and last visible day, inclusive. */
  readonly from: string;
  readonly to: string;
  /** The zone all times are shown in. */
  readonly timeZone: string;
  readonly entries: readonly CalendarViewEntry[];
  readonly targets: readonly CalendarTarget[];
  readonly projects: readonly CalendarPageProject[];
}

/** The changes the calendar page sends. */
export type CalendarPageIntent =
  "create" | "update" | "delete" | "respond" | "search-invitees";

/** The reasons a change fails, as keys under `calendar.errors`. */
export type CalendarPageError =
  "forbidden" | "not_found" | "invalid_request" | "conflict" | "too_large";

/** One choice of the invitee search. */
export interface CalendarInviteeChoice {
  readonly kind: CalendarInviteeKind;
  readonly id: string;
  readonly name: string;
}

/** What a change of the calendar page answers. */
export type CalendarPageActionData =
  | {
      readonly ok: true;
      readonly intent: CalendarPageIntent;
      /** The choices of `search-invitees`. */
      readonly invitees?: readonly CalendarInviteeChoice[];
    }
  | {
      readonly ok: false;
      readonly intent: CalendarPageIntent;
      readonly error: CalendarPageError;
    };

function hasCalendarLists(value: object): boolean {
  return (
    "entries" in value &&
    Array.isArray(value.entries) &&
    "targets" in value &&
    Array.isArray(value.targets) &&
    "projects" in value &&
    Array.isArray(value.projects)
  );
}

/**
 * Recognizes the answer of the calendar endpoint.
 *
 * @param value - The parsed answer.
 */
export function isCalendarPageData(value: unknown): value is CalendarPageData {
  if (typeof value !== "object" || value === null) return false;
  return (
    "userId" in value &&
    typeof value.userId === "string" &&
    "view" in value &&
    typeof value.view === "string" &&
    "date" in value &&
    typeof value.date === "string" &&
    "timeZone" in value &&
    typeof value.timeZone === "string" &&
    hasCalendarLists(value)
  );
}

/**
 * Recognizes the answer of a change of the calendar page.
 *
 * @param value - What a fetcher holds.
 */
export function isCalendarActionData(
  value: unknown,
): value is CalendarPageActionData {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    typeof value.ok === "boolean" &&
    "intent" in value &&
    typeof value.intent === "string"
  );
}
