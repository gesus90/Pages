import { authenticatedUserContext } from "@/app/lib/auth.server";
import { readLocalStateAudience } from "@/app/lib/local-state/local-state-audience.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { readWikiRequest } from "@/app/lib/wiki-actions/wiki-action-support.server";
import { handleWikiLayoutAction } from "@/app/lib/wiki-actions/wiki-layout-actions.server";

import type { WikiActionOutcome } from "@/app/lib/wiki-actions/wiki-action-support.server";
import type { WikiShellData } from "./wiki";
import type { Route } from "./+types/wiki-server";

/** Loads the page tree and the templates for the wiki navigation. */
export async function loader({
  context,
}: Route.LoaderArgs): Promise<WikiShellData> {
  const actor = context.get(authenticatedUserContext);

  if (!actor) {
    throw new Error("Authenticated middleware did not provide a user.");
  }

  const services = await getApplicationServices();
  const { wikiService } = services;
  const [navigation, templates, people, audience] = await Promise.all([
    wikiService.navigation(actor),
    wikiService.templates(actor),
    wikiService.ownerCandidates(actor),
    readLocalStateAudience(services, actor),
  ]);

  return {
    navigation,
    people,
    templates,
    today: new Date().toISOString().slice(0, 10),
    audience,
  };
}

/** Changes the structure of the wiki: create, move, delete, restore. */
export async function action(
  args: Route.ActionArgs,
): Promise<WikiActionOutcome> {
  return handleWikiLayoutAction(await readWikiRequest(args, null));
}
