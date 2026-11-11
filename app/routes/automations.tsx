import { useLoaderData } from "react-router";

import { AutomationsPage } from "@/app/components/automations/automations-page";
import { sendToBackend } from "@/app/lib/backend-request";
import { readRouteData } from "@/app/lib/local-state/route-data";

import type { AutomationPageData } from "@/definition/AutomationPage";
import type { Route } from "./+types/automations";

/** The endpoint of the automation page; it reads with the rights of the signed-in account. */
export const AUTOMATIONS_PAGE_ENDPOINT = "/automationen-api/page";

/** Recognizes the answer of the automation page endpoint. */
export function isAutomationPageData(
  value: unknown,
): value is AutomationPageData {
  return (
    typeof value === "object" &&
    value !== null &&
    "automations" in value &&
    Array.isArray(value.automations) &&
    "history" in value &&
    Array.isArray(value.history) &&
    "options" in value &&
    typeof value.options === "object" &&
    "names" in value &&
    typeof value.names === "object"
  );
}

/** Reads the automations, their runs and the options (PAGE-297). */
export function clientLoader({
  request,
}: Route.ClientLoaderArgs): Promise<AutomationPageData> {
  return readRouteData({
    endpoint: AUTOMATIONS_PAGE_ENDPOINT,
    signal: request.signal,
    isPayload: isAutomationPageData,
  });
}

/** Sends a change of the automation page to the API, which runs the page's action. */
export async function clientAction({
  request,
}: Route.ClientActionArgs): Promise<unknown> {
  return sendToBackend(request);
}

/** Renders the page of automations. */
export default function AutomationsRoute(): React.ReactElement {
  return <AutomationsPage data={useLoaderData<typeof clientLoader>()} />;
}
