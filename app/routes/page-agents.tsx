import { redirect } from "react-router";
import type { Route } from "./+types/page-agents";

/** Retired definition management opens the direct model plan editor without deleting legacy data. */
export function loader(): Response {
  return redirect("/agents/plans?notice=direct-models");
}

/** Old form submissions cannot reopen profile management. */
export function action({ request }: Route.ActionArgs): Response {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  return redirect("/agents/plans?notice=direct-models", 303);
}
