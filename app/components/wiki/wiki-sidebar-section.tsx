import { useRouteLoaderData } from "react-router";

import { WIKI_SEARCH_EVENT } from "@/app/components/wiki/wiki-shell";
import { WikiNavigation } from "@/app/components/wiki/wiki-navigation";

import type { loader as wikiLoader } from "@/app/routes/wiki";

interface WikiSidebarSectionProps {
  /** Called when a link was followed, so the mobile menu can close. */
  readonly onNavigate?: () => void;
}

/**
 * The wiki navigation as indented section below "Wiki" in the main sidebar,
 * shown while a wiki page is open (A8 §2): search, new page, favorites,
 * recent pages and the page trees with the open path expanded.
 *
 * @remarks
 * It reads the data the wiki route already loaded, so the sidebar needs no
 * request of its own. Which branches are open is stored per person and
 * comes back when the person returns to the wiki.
 */
export function WikiSidebarSection({
  onNavigate,
}: WikiSidebarSectionProps): React.ReactElement | null {
  const shell = useRouteLoaderData<typeof wikiLoader>("routes/wiki");

  if (!shell) {
    return null;
  }

  return (
    <div className="pages-hover-scrollbar mt-1 ml-4 min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto border-l border-border pl-2">
      <WikiNavigation
        navigation={shell.navigation}
        templates={shell.templates}
        today={shell.today}
        onNavigate={onNavigate}
        onSearch={() => {
          onNavigate?.();
          window.dispatchEvent(new Event(WIKI_SEARCH_EVENT));
        }}
      />
    </div>
  );
}
