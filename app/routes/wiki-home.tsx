import { useLoaderData } from "react-router";

import { useLocalStateRoute } from "@/app/components/common/use-local-state-route";
import { WikiHomeView } from "@/app/components/wiki/wiki-home-view";
import {
  isCurrentLocalStateAudience,
  isLocalStateAudience,
} from "@/app/lib/local-state/local-state-audience";
import {
  loadLocalFirst,
  localStateRoute,
} from "@/app/lib/local-state/local-state-loader";
import { readRouteData } from "@/app/lib/local-state/route-data";

import type { LocalStateRouteKind } from "@/app/components/common/use-local-state-route";
import type { LocalStateAudience } from "@/app/lib/local-state/local-state-audience";
import type { WithLocalState } from "@/app/lib/local-state/local-state-loader";
import type { WikiFeedItem, WikiHome } from "@/definition/Wiki";
import type { Route } from "./+types/wiki-home";

/** The wiki start page as its endpoint answers it. */
export interface WikiHomeLoaderData {
  readonly home: WikiHome;
  readonly feed: readonly WikiFeedItem[];
  readonly audience: LocalStateAudience;
}

function isWikiHomeLoaderData(value: unknown): value is WikiHomeLoaderData {
  return (
    typeof value === "object" &&
    value !== null &&
    "home" in value &&
    typeof value.home === "object" &&
    value.home !== null &&
    "feed" in value &&
    Array.isArray(value.feed) &&
    "audience" in value &&
    isLocalStateAudience(value.audience)
  );
}

/** The wiki start page, kept per account, rights and address. */
const WIKI_HOME_STATE: LocalStateRouteKind<WikiHomeLoaderData> = {
  schemaVersion: 1,
  isPayload: isWikiHomeLoaderData,
  isCurrent: (page) => isCurrentLocalStateAudience(page.audience),
  ownerOf: (page) => page.audience.userId,
  isRefused: () => false,
  isIndex: true,
};

/**
 * Opens the start page from the account's kept answer at once and asks the endpoint behind it.
 *
 * @remarks
 * The endpoint runs the server loader with its permission checks.
 */
export async function clientLoader({
  request,
}: Route.ClientLoaderArgs): Promise<WithLocalState<WikiHomeLoaderData>> {
  const url = new URL(request.url);
  // The background refresh names the index route; the address has no such field.
  url.searchParams.delete("index");
  return loadLocalFirst(localStateRoute(url), WIKI_HOME_STATE, () =>
    readRouteData({
      endpoint: `/wiki-api/home${url.search}`,
      signal: request.signal,
      isPayload: isWikiHomeLoaderData,
    }),
  );
}

/** Renders the wiki start page. */
export default function WikiHomeRoute(): React.ReactElement {
  const { feed, home } = useLocalStateRoute(
    useLoaderData<typeof clientLoader>(),
    WIKI_HOME_STATE,
  );

  return <WikiHomeView feed={feed} home={home} />;
}
