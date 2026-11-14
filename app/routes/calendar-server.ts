import { data } from "react-router";

import { readZonedParts } from "@/app/components/automations/automation-zoned-time";
import {
  isCalendarDate,
  readCalendarView,
  visibleRange,
} from "@/app/components/calendar/calendar-dates";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { CalendarError } from "@/backend/error/CalendarError";
import { logCaughtError } from "@/backend/logging/Logger";
import {
  CALENDAR_LIMITS,
  CALENDAR_SCOPES,
  calendarAnswerSchema,
} from "@/definition/Calendar";

import type {
  CalendarInviteeChoice,
  CalendarPageActionData,
  CalendarPageData,
  CalendarPageIntent,
} from "@/app/components/calendar/calendar-page-data";
import type { CalendarErrorCode } from "@/backend/error/CalendarError";
import type { CalendarService } from "@/backend/service/calendar/CalendarService";
import type { CalendarScope } from "@/definition/Calendar";
import type { User } from "@/definition/User";
import type { Route } from "./+types/calendar-server";

const INTENTS: readonly CalendarPageIntent[] = [
  "create",
  "update",
  "delete",
  "respond",
  "search-invitees",
];

const ERROR_STATUS: Readonly<Record<CalendarErrorCode, number>> = {
  forbidden: 403,
  not_found: 404,
  invalid_request: 400,
  conflict: 409,
  too_large: 413,
};

/** How many invitee choices the search of the page offers. */
const INVITEE_CHOICES = 12;

function pad(part: number): string {
  return String(part).padStart(2, "0");
}

function todayIn(timeZone: string): string {
  const { year, month, day } = readZonedParts(new Date(), timeZone);
  return `${year}-${pad(month)}-${pad(day)}`;
}

function readIntent(
  value: FormDataEntryValue | null,
): CalendarPageIntent | null {
  return INTENTS.find((intent) => intent === value) ?? null;
}

function readText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function readJson(formData: FormData, key: string): unknown {
  try {
    return JSON.parse(readText(formData, key));
  } catch (error: unknown) {
    if (error instanceof SyntaxError)
      throw new CalendarError("invalid_request", "The fields are unreadable.");
    throw error;
  }
}

function readScope(formData: FormData): CalendarScope {
  const scope = CALENDAR_SCOPES.find(
    (candidate) => candidate === formData.get("scope"),
  );
  if (!scope)
    throw new CalendarError("invalid_request", "The scope is unknown.");
  return scope;
}

function readTarget(formData: FormData): {
  readonly id: string;
  readonly scope: CalendarScope;
  readonly occurrenceStart: string | null;
} {
  const occurrenceStart = readText(formData, "occurrenceStart");
  return {
    id: readText(formData, "id"),
    scope: readScope(formData),
    occurrenceStart: occurrenceStart === "" ? null : occurrenceStart,
  };
}

/** Runs one change; only the invitee search answers more than success. */
async function runIntent(
  calendar: CalendarService,
  person: User,
  intent: CalendarPageIntent,
  formData: FormData,
): Promise<readonly CalendarInviteeChoice[] | undefined> {
  switch (intent) {
    case "create":
      await calendar.create(person, readJson(formData, "fields"));
      return undefined;
    case "update":
      await calendar.update(
        person,
        readTarget(formData),
        readJson(formData, "patch"),
      );
      return undefined;
    case "delete":
      await calendar.delete(person, readTarget(formData));
      return undefined;
    case "respond": {
      const answer = calendarAnswerSchema.safeParse(formData.get("answer"));
      if (!answer.success)
        throw new CalendarError("invalid_request", "The answer is unknown.");
      await calendar.respond(person, readText(formData, "id"), answer.data);
      return undefined;
    }
    case "search-invitees":
      return calendar.searchInvitees(
        person,
        readText(formData, "text").trim(),
        INVITEE_CHOICES,
      );
  }
}

/**
 * Loads the visible range of the calendar page (PAGE-301): the entries of
 * the signed-in account, the calendars it may put events into and its
 * projects for the filter list.
 *
 * @remarks
 * `view` and `date` of the address choose the range; without them the week
 * of today in the account's zone shows. Every time comes in that zone.
 */
export async function loader({
  request,
  context,
}: Route.LoaderArgs): Promise<CalendarPageData> {
  const person = context.get(authenticatedUserContext);
  if (!person) throw new Response("Forbidden", { status: 403 });
  const { calendarService } = await getApplicationServices();
  const viewer = await calendarService.viewer(person);
  const url = new URL(request.url);
  const today = todayIn(viewer.timeZone);
  const view = readCalendarView(url.searchParams.get("view")) ?? "week";
  const requested = url.searchParams.get("date") ?? "";
  const date = isCalendarDate(requested) ? requested : today;
  const range = visibleRange(view, date);
  const [calendarRange, targets] = await Promise.all([
    calendarService.readRange(person, range),
    calendarService.targets(person),
  ]);
  return {
    userId: person.id,
    view,
    date,
    today,
    from: range.from,
    to: range.to,
    timeZone: calendarRange.timeZone,
    entries: calendarRange.entries.slice(0, CALENDAR_LIMITS.rangeEntries),
    targets,
    projects: viewer.projects.map(({ id, name }) => ({ id, name })),
  };
}

/**
 * Creates, changes, deletes or answers an event, or searches whom to invite.
 *
 * @remarks
 * The calendar service checks every right; a refusal answers with the
 * status of its code and a key the page shows, never with foreign data.
 */
export async function action({
  request,
  context,
}: Route.ActionArgs): Promise<ReturnType<typeof data<CalendarPageActionData>>> {
  const person = context.get(authenticatedUserContext);
  if (!person) throw new Response("Forbidden", { status: 403 });
  const formData = await request.formData();
  const intent = readIntent(formData.get("intent"));
  if (!intent) throw new Response("Bad Request", { status: 400 });
  const { calendarService } = await getApplicationServices();
  try {
    const invitees = await runIntent(calendarService, person, intent, formData);
    return data<CalendarPageActionData>({ ok: true, intent, invitees });
  } catch (error: unknown) {
    if (!(error instanceof CalendarError)) throw error;
    logCaughtError("calendar_page", error);
    return data<CalendarPageActionData>(
      { ok: false, intent, error: error.code },
      { status: ERROR_STATUS[error.code] },
    );
  }
}
