import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";

import type { Route } from "./+types/wiki-link-titles";

/** Largest number of identifiers one request may resolve. */
const MAXIMUM_IDS = 50;

/**
 * Resolves the titles of wiki pages that tickets and projects link to.
 *
 * @remarks
 * Pages the person may not see are left out, so a link never reveals a title
 * and a missing page looks like a hidden one.
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
  const ids = (new URL(request.url).searchParams.get("ids") ?? "")
    .split(",")
    .filter((id) => id !== "")
    .slice(0, MAXIMUM_IDS);

  return Response.json({ titles: await wikiService.linkTitles(actor, ids) });
}
