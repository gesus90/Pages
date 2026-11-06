import { useRouteLoaderData } from "react-router";

import {
  createLocalStateLayoutAnswers,
  useLocalStateLayoutAnswer,
} from "@/app/components/common/use-local-state-layout";
import { readWikiShell, WIKI_SHELL_ENDPOINT } from "@/app/lib/wiki-shell-state";

import type { LocalStateLayoutSource } from "@/app/components/common/use-local-state-layout";
import type { WithLocalState } from "@/app/lib/local-state/local-state-loader";
import type { clientLoader, WikiShellData } from "@/app/routes/wiki";

/** The wiki frame's kept answers do not depend on the address. */
export const WIKI_SHELL_SOURCE: LocalStateLayoutSource<WikiShellData> = {
  route: WIKI_SHELL_ENDPOINT,
  read: readWikiShell,
  answers: createLocalStateLayoutAnswers(),
};

/**
 * The wiki frame's data as the wiki route shows it, also outside the route.
 *
 * @remarks
 * The wiki route refreshes a kept answer from its endpoint; every reader
 * gets that answer, so the sidebar and the page show the same tree.
 *
 * @returns The data, or `undefined` outside the wiki.
 */
export function useWikiShell(): WithLocalState<WikiShellData> | undefined {
  return useLocalStateLayoutAnswer(
    useRouteLoaderData<typeof clientLoader>("routes/wiki"),
    WIKI_SHELL_SOURCE,
  );
}
