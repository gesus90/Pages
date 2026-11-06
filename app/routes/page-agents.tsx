import { redirect } from "react-router";

import { sendToBackend } from "@/app/lib/backend-request";

import type { Route } from "./+types/page-agents";

/** Where the retired definition management sends the visitor. */
export const PLAN_EDITOR = "/agents/plans?notice=direct-models";

/** Opens the plan editor in the browser; the plan page checks the account itself. */
export function clientLoader(): Response {
  return redirect(PLAN_EDITOR);
}

/** Sends an old form submission to the API, which runs the page's action. */
export async function clientAction({
  request,
}: Route.ClientActionArgs): Promise<unknown> {
  return sendToBackend(request);
}
