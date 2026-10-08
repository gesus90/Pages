import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { readSearchParams } from "@/app/lib/wiki-search-params";
import { WikiValidationError } from "@/backend/error/WikiErrors";

import type { Route } from "./+types/wiki-search";

/**
 * Answers a search of the wiki as JSON.
 *
 * @remarks
 * The service filters by visibility before it matches, ranks and counts, so
 * the answer holds nothing the person may not see. An invalid filter value
 * yields an empty answer.
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
  const input = readSearchParams(new URL(request.url).searchParams);

  try {
    return Response.json(await wikiService.search(actor, input));
  } catch (error: unknown) {
    if (error instanceof WikiValidationError) {
      return Response.json({ results: [], total: 0 });
    }

    throw error;
  }
}
