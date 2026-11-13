import { redirect, useLoaderData } from "react-router";

import { CalendarPage } from "@/app/components/calendar/calendar-page";
import { isCalendarPageData } from "@/app/components/calendar/calendar-page-data";
import { readCalendarPreferences } from "@/app/components/calendar/use-calendar-preferences";
import { sendToBackend } from "@/app/lib/backend-request";
import { readRouteData } from "@/app/lib/local-state/route-data";

import type { ShouldRevalidateFunctionArgs } from "react-router";
import type { CalendarPageData } from "@/app/components/calendar/calendar-page-data";
import type { CalendarView } from "@/definition/Calendar";
import type { Route } from "./+types/calendar";

/** The endpoint of the calendar page; it reads with the rights of the signed-in account. */
export const CALENDAR_PAGE_ENDPOINT = "/kalender-api/page";

/** Narrow screens open the list instead of the week. */
const NARROW_QUERY = "(max-width: 47.99rem)";

/** The changes after which the page keeps its data. */
const QUIET_INTENTS: readonly string[] = ["search-invitees"];

function defaultView(): CalendarView {
  return window.matchMedia(NARROW_QUERY).matches ? "list" : "week";
}

/**
 * Reads the visible range of the calendar page (PAGE-301) from its endpoint.
 *
 * @remarks
 * An address without a view opens the view the account used last, or the
 * week (the list on narrow screens); the kept view lives in the browser.
 */
export async function clientLoader({
  request,
}: Route.ClientLoaderArgs): Promise<CalendarPageData> {
  const url = new URL(request.url);
  const hasView = url.searchParams.has("view");
  if (!hasView) url.searchParams.set("view", defaultView());
  const page = await readRouteData({
    endpoint: `${CALENDAR_PAGE_ENDPOINT}${url.search}`,
    signal: request.signal,
    isPayload: isCalendarPageData,
  });
  const keptView = hasView ? null : readCalendarPreferences(page.userId).view;
  if (keptView !== null && keptView !== page.view) {
    url.searchParams.set("view", keptView);
    throw redirect(`${url.pathname}${url.search}`);
  }
  return page;
}

/** Searching whom to invite changes nothing, so the page keeps its data. */
export function shouldRevalidate({
  formData,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs): boolean {
  const intent = formData?.get("intent");
  return typeof intent === "string" && QUIET_INTENTS.includes(intent)
    ? false
    : defaultShouldRevalidate;
}

/** Sends a change of the calendar page to the API, which runs the page's action. */
export async function clientAction({
  request,
}: Route.ClientActionArgs): Promise<unknown> {
  return sendToBackend(request);
}

/** Renders the calendar page. */
export default function CalendarRoute(): React.ReactElement {
  return <CalendarPage page={useLoaderData<typeof clientLoader>()} />;
}
