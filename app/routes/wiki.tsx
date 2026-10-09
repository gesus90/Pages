import { useLoaderData } from "react-router";

import { WikiShell } from "@/app/components/wiki/wiki-shell";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { readWikiRequest } from "@/app/lib/wiki-actions/wiki-action-support.server";
import { handleWikiLayoutAction } from "@/app/lib/wiki-actions/wiki-layout-actions.server";

import type { WikiActionOutcome } from "@/app/lib/wiki-actions/wiki-action-support.server";
import type { WikiNavigation, WikiOwnerCandidate } from "@/definition/Wiki";
import type { Route } from "./+types/wiki";

interface WikiLoaderData {
  readonly navigation: WikiNavigation;
  /** Accounts a page can be handed to and that can be filtered by; empty for readers. */
  readonly people: readonly WikiOwnerCandidate[];
  readonly templates: readonly {
    readonly id: string;
    readonly title: string;
    readonly icon: string | null;
  }[];
  /** Today as `YYYY-MM-DD` on the server, so pages and browsers agree. */
  readonly today: string;
}

/** Loads the page tree and the templates for the wiki navigation. */
export async function loader({
  context,
}: Route.LoaderArgs): Promise<WikiLoaderData> {
  const actor = context.get(authenticatedUserContext);

  if (!actor) {
    throw new Error("Authenticated middleware did not provide a user.");
  }

  const { wikiService } = await getApplicationServices();
  const [navigation, templates, people] = await Promise.all([
    wikiService.navigation(actor),
    wikiService.templates(actor),
    wikiService.ownerCandidates(actor),
  ]);

  return {
    navigation,
    people,
    templates,
    today: new Date().toISOString().slice(0, 10),
  };
}

/** Changes the structure of the wiki: create, move, delete, restore. */
export async function action(
  args: Route.ActionArgs,
): Promise<WikiActionOutcome> {
  return handleWikiLayoutAction(await readWikiRequest(args, null));
}

/** Renders the wiki frame around the open page. */
export default function WikiRoute(): React.ReactElement {
  // Templates and today serve the wiki navigation in the main sidebar,
  // which reads them from this loader.
  const { navigation, people } = useLoaderData<typeof loader>();

  return <WikiShell navigation={navigation} people={people} />;
}
