import { authenticatedUserContext } from "@/app/lib/auth.server";
import { readLocalStateAudience } from "@/app/lib/local-state/local-state-audience.server";
import { getApplicationServices } from "@/app/lib/services.server";

import type { WikiHomeLoaderData } from "./wiki-home";
import type { Route } from "./+types/wiki-home-server";

/** Loads the lists of the wiki start page. */
export async function loader({
  context,
}: Route.LoaderArgs): Promise<WikiHomeLoaderData> {
  const actor = context.get(authenticatedUserContext);

  if (!actor) {
    throw new Error("Authenticated middleware did not provide a user.");
  }

  const services = await getApplicationServices();
  const { wikiService } = services;

  const [home, feed, audience] = await Promise.all([
    wikiService.home(actor),
    wikiService.forMe(actor),
    readLocalStateAudience(services, actor),
  ]);

  return { feed, home, audience };
}
