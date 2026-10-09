import { useEffect, useState } from "react";
import { Outlet, useParams } from "react-router";

import { WikiSearchDialog } from "@/app/components/wiki/wiki-search-dialog";

import type {
  WikiNavigation as WikiNavigationData,
  WikiOwnerCandidate,
} from "@/definition/Wiki";

interface WikiShellProps {
  readonly navigation: WikiNavigationData;
  readonly people: readonly WikiOwnerCandidate[];
}

/** The event that the wiki navigation in the sidebar sends to open the search. */
export const WIKI_SEARCH_EVENT = "pages:wiki-search";

/**
 * Opens the search with Ctrl or Cmd + K, as in other tools, and when the
 * sidebar asks for it. A shortcut the editor already used (its link
 * dialog) does not open the search as well.
 */
function useSearchRequests(open: () => void): void {
  useEffect(() => {
    const listen = (event: KeyboardEvent): void => {
      if (
        !event.defaultPrevented &&
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        open();
      }
    };

    window.addEventListener("keydown", listen);
    window.addEventListener(WIKI_SEARCH_EVENT, open);

    return () => {
      window.removeEventListener("keydown", listen);
      window.removeEventListener(WIKI_SEARCH_EVENT, open);
    };
  }, [open]);
}

/**
 * The wiki frame around the open page. Its navigation lives in the main
 * sidebar below "Wiki" (A8.1); the frame keeps the search.
 */
export function WikiShell({
  navigation,
  people,
}: WikiShellProps): React.ReactElement {
  const { pageId = null } = useParams();
  const [isSearching, setIsSearching] = useState(false);

  useSearchRequests(() => setIsSearching(true));

  return (
    <div className="mx-auto max-w-[80rem]">
      <Outlet />
      {isSearching ? (
        <WikiSearchDialog
          navigation={navigation}
          pageId={pageId}
          people={people}
          onClose={() => setIsSearching(false)}
        />
      ) : null}
    </div>
  );
}
