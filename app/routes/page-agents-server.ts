import { redirect } from "react-router";

import { PLAN_EDITOR } from "./page-agents";

import type { Route } from "./+types/page-agents-server";

/** Retired definition management opens the direct model plan editor without deleting legacy data. */
export function loader(): Response {
  return redirect(PLAN_EDITOR);
}

/** Old form submissions cannot reopen profile management. */
export function action({ request }: Route.ActionArgs): Response {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  return redirect(PLAN_EDITOR, 303);
}
