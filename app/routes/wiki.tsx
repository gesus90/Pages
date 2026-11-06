import { useLoaderData, useLocation } from "react-router";

import { useLocalStateLayout } from "@/app/components/common/use-local-state-layout";
import { WIKI_SHELL_SOURCE } from "@/app/components/wiki/use-wiki-shell";
import { WikiShell } from "@/app/components/wiki/wiki-shell";
import { loadLocalFirst } from "@/app/lib/local-state/local-state-loader";
import { isLocalStateNavigation } from "@/app/lib/local-state/local-state-navigation";
import { sendToBackend } from "@/app/lib/backend-request";
import {
  readWikiShell,
  WIKI_SHELL_ENDPOINT,
  WIKI_SHELL_STATE,
} from "@/app/lib/wiki-shell-state";

import type { ShouldRevalidateFunctionArgs } from "react-router";
import type { LocalStateAudience } from "@/app/lib/local-state/local-state-audience";
import type { WithLocalState } from "@/app/lib/local-state/local-state-loader";
import type { WikiNavigation, WikiOwnerCandidate } from "@/definition/Wiki";
import type { Route } from "./+types/wiki";

/** What the wiki frame and the wiki navigation of the sidebar show. */
export interface WikiShellData {
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
  readonly audience: LocalStateAudience;
}

/**
 * Opens the wiki frame from the account's kept answer at once; the frame asks the endpoint behind it.
 *
 * @remarks
 * Without a kept answer the frame comes from its rights-checked endpoint,
 * which runs the server loader's checks.
 */
export async function clientLoader({
  request,
}: Route.ClientLoaderArgs): Promise<WithLocalState<WikiShellData>> {
  return loadLocalFirst(WIKI_SHELL_ENDPOINT, WIKI_SHELL_STATE, () =>
    readWikiShell(request.signal),
  );
}

/**
 * Reloads the frame after a change, a live notice and when the page is
 * refreshed. Moving between wiki pages does not wait for it: the frame asks
 * its endpoint behind the shown tree instead.
 */
export function shouldRevalidate(args: ShouldRevalidateFunctionArgs): boolean {
  return isLocalStateNavigation(args) ? false : args.defaultShouldRevalidate;
}

/** Sends a change of the wiki structure to the API, which runs the page's action. */
export async function clientAction({
  request,
}: Route.ClientActionArgs): Promise<unknown> {
  return sendToBackend(request);
}

/** Renders the wiki frame around the open page. */
export default function WikiRoute(): React.ReactElement {
  // Templates and today serve the wiki navigation in the main sidebar,
  // which reads them through the same source.
  const loaded = useLoaderData<typeof clientLoader>();
  const { pathname } = useLocation();
  const { navigation, people } =
    useLocalStateLayout(
      loaded,
      WIKI_SHELL_STATE,
      WIKI_SHELL_SOURCE,
      pathname,
    ) ?? loaded;

  return <WikiShell navigation={navigation} people={people} />;
}
