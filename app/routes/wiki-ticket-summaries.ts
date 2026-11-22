import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";

import type { Route } from "./+types/wiki-ticket-summaries";

/** Largest number of ticket keys one request may resolve. */
const MAXIMUM_KEYS = 50;

/**
 * Resolves status, title, person and version of the tickets that wiki text
 * links to, for the status pills of ticket links.
 * @remarks
 * Tickets the person may not see are left out, so a link never reveals a
 * status or title and a missing ticket looks like a hidden one.
 */
export async function loader({
  context,
  request,
}: Route.LoaderArgs): Promise<Response> {
  const actor = context.get(authenticatedUserContext);

  if (!actor) {
    throw new Response("Forbidden", { status: 403 });
  }

  const { wikiService } = await getApplicationServices();
  const keys = (new URL(request.url).searchParams.get("keys") ?? "")
    .split(",")
    .filter((key) => key !== "")
    .slice(0, MAXIMUM_KEYS);

  return Response.json(
    { tickets: await wikiService.ticketSummaries(actor, keys) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
