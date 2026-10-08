import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";

import type { Route } from "./+types/wiki-references";

/**
 * Offers pages, tickets and people for the `[[` and `@` pickers as JSON.
 *
 * @remarks
 * Pages and tickets appear only when the person may see them.
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
  const query = new URL(request.url).searchParams.get("q") ?? "";

  return Response.json({
    references: await wikiService.references(actor, query),
  });
}
