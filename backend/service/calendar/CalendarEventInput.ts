import { CalendarError } from "@/backend/error/CalendarError";
import { CALENDAR_WEEKDAYS } from "@/definition/Calendar";

import { dateIn, parseInstant, toUtcText, weekdayIndex } from "./CalendarTime";

import type { CalendarDirectoryRepository } from "@/backend/database/repositories/calendar/CalendarDirectoryRepository";
import type {
  CalendarInviteeReference,
  CalendarRecurrence,
} from "@/definition/Calendar";

/** The stored form of start, end and all-day. */
export interface StoredCalendarTime {
  readonly allDay: boolean;
  readonly startAt: string;
  readonly endAt: string;
  /** The first date in the zone the time was read in. */
  readonly startDate: string;
}

/**
 * Reads start and end of a client into their stored form.
 *
 * @param fields - Start, end and whether the event is all-day.
 * @param timeZone - The zone dates and times without offset are read in.
 * @throws {CalendarError} `invalid_request` when the end lies before the start.
 */
export function readCalendarTime(
  fields: {
    readonly start: string;
    readonly end: string;
    readonly allDay: boolean;
  },
  timeZone: string,
): StoredCalendarTime {
  if (fields.allDay) {
    const startDate = dateIn(fields.start, timeZone);
    const endDate = dateIn(fields.end, timeZone);
    if (endDate < startDate)
      throw new CalendarError(
        "invalid_request",
        "The event ends before it starts.",
      );
    return { allDay: true, startAt: startDate, endAt: endDate, startDate };
  }
  const startMs = parseInstant(fields.start, timeZone);
  const endMs = parseInstant(fields.end, timeZone);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs)
    throw new CalendarError(
      "invalid_request",
      "The event ends before it starts.",
    );
  return {
    allDay: false,
    startAt: toUtcText(startMs),
    endAt: toUtcText(endMs),
    startDate: dateIn(toUtcText(startMs), timeZone),
  };
}

/**
 * Completes and checks the rule of a series.
 *
 * @param rule - The rule of the client, or `null`.
 * @param startDate - The first date of the series in its zone.
 * @returns The rule; a weekly rule without weekdays repeats on the weekday
 * of its start.
 * @throws {CalendarError} `invalid_request` for an end before the start.
 */
export function normalizeRecurrence(
  rule: CalendarRecurrence | null,
  startDate: string,
): CalendarRecurrence | null {
  if (rule === null) return null;
  if (rule.until !== null && rule.until < startDate)
    throw new CalendarError(
      "invalid_request",
      "The series ends before it starts.",
    );
  if (rule.frequency !== "weekly") return { ...rule, weekdays: [] };
  const weekdays =
    rule.weekdays.length === 0
      ? [CALENDAR_WEEKDAYS[weekdayIndex(startDate)] ?? "mo"]
      : CALENDAR_WEEKDAYS.filter((day) => rule.weekdays.includes(day));
  return { ...rule, weekdays };
}

/**
 * Checks the invitees of a client against the directory.
 *
 * @param directory - People, agents, groups and departments.
 * @param invitees - The list of the client.
 * @returns The list without duplicates, in its order.
 * @throws {CalendarError} `invalid_request` for an unknown or inactive
 * invitee, or a person named as agent or the other way round.
 */
export async function checkCalendarInvitees(
  directory: Pick<
    CalendarDirectoryRepository,
    "findAccounts" | "findGroups" | "findDepartments"
  >,
  invitees: readonly CalendarInviteeReference[],
): Promise<CalendarInviteeReference[]> {
  const seen = new Set<string>();
  const unique = invitees.filter((invitee) => {
    const key = `${invitee.kind}:${invitee.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const idsOf = (kinds: readonly string[]): string[] =>
    unique
      .filter((invitee) => kinds.includes(invitee.kind))
      .map((invitee) => invitee.id);
  const accounts = new Map(
    (await directory.findAccounts(idsOf(["person", "agent"]))).map(
      (account) => [account.id, account],
    ),
  );
  const groups = new Set(
    (await directory.findGroups(idsOf(["group"]))).map((group) => group.id),
  );
  const departments = new Set(
    (await directory.findDepartments(idsOf(["department"]))).map(
      (entry) => entry.id,
    ),
  );
  for (const invitee of unique) {
    const account = accounts.get(invitee.id);
    const isValid =
      (invitee.kind === "group" && groups.has(invitee.id)) ||
      (invitee.kind === "department" && departments.has(invitee.id)) ||
      (invitee.kind === "person" &&
        account?.isActive === true &&
        !account.isAgent) ||
      (invitee.kind === "agent" &&
        account?.isActive === true &&
        account.isAgent);
    if (!isValid)
      throw new CalendarError(
        "invalid_request",
        "An invitee cannot be invited.",
      );
  }
  return unique;
}
