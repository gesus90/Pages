import { useLoaderData } from "react-router";

import { useLocalStateRoute } from "@/app/components/common/use-local-state-route";
import { WikiTrashView } from "@/app/components/wiki/wiki-trash-view";
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
import type { WikiTrashItem } from "@/app/components/wiki/wiki-trash-view";
import type { LocalStateAudience } from "@/app/lib/local-state/local-state-audience";
import type { WithLocalState } from "@/app/lib/local-state/local-state-loader";
import type { Route } from "./+types/wiki-trash";

/** The wiki trash as its endpoint answers it. */
export interface WikiTrashLoaderData {
  readonly entries: readonly WikiTrashItem[];
  readonly audience: LocalStateAudience;
}

function isWikiTrashLoaderData(value: unknown): value is WikiTrashLoaderData {
  return (
    typeof value === "object" &&
    value !== null &&
    "entries" in value &&
    Array.isArray(value.entries) &&
    "audience" in value &&
    isLocalStateAudience(value.audience)
  );
}

/** The wiki trash, kept per account, rights and address. */
const WIKI_TRASH_STATE: LocalStateRouteKind<WikiTrashLoaderData> = {
  schemaVersion: 1,
  isPayload: isWikiTrashLoaderData,
  isCurrent: (page) => isCurrentLocalStateAudience(page.audience),
  ownerOf: (page) => page.audience.userId,
  isRefused: () => false,
};

/**
 * Opens the trash from the account's kept answer at once and asks the endpoint behind it.
 *
 * @remarks
 * The endpoint runs the server loader with its permission checks.
 */
export async function clientLoader({
  request,
}: Route.ClientLoaderArgs): Promise<WithLocalState<WikiTrashLoaderData>> {
  const url = new URL(request.url);
  return loadLocalFirst(localStateRoute(url), WIKI_TRASH_STATE, () =>
    readRouteData({
      endpoint: `/wiki-api/trash${url.search}`,
      signal: request.signal,
      isPayload: isWikiTrashLoaderData,
    }),
  );
}

/** Renders the wiki trash. */
export default function WikiTrashRoute(): React.ReactElement {
  const { entries } = useLocalStateRoute(
    useLoaderData<typeof clientLoader>(),
    WIKI_TRASH_STATE,
  );

  return <WikiTrashView entries={entries} />;
}
