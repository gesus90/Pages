import { useLoaderData } from "react-router";

import { WikiHomeView } from "@/app/components/wiki/wiki-home-view";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";

import type { WikiFeedItem, WikiHome } from "@/definition/Wiki";
import type { Route } from "./+types/wiki-home";

/** Loads the lists of the wiki start page. */
export async function loader({ context }: Route.LoaderArgs): Promise<{
  readonly home: WikiHome;
  readonly feed: readonly WikiFeedItem[];
}> {
  const actor = context.get(authenticatedUserContext);

  if (!actor) {
    throw new Error("Authenticated middleware did not provide a user.");
  }

  const { wikiService } = await getApplicationServices();

  const [home, feed] = await Promise.all([
    wikiService.home(actor),
    wikiService.forMe(actor),
  ]);

  return { feed, home };
}

/** Renders the wiki start page. */
export default function WikiHomeRoute(): React.ReactElement {
  const { feed, home } = useLoaderData<typeof loader>();

  return <WikiHomeView feed={feed} home={home} />;
}
