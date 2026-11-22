import { ChevronsLeft, PanelLeftOpen } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { ScrollViewport } from "@/app/components/ui/scroll-viewport";
import { Sheet, SheetContent, SheetTitle } from "@/app/components/ui/sheet";
import { useWikiShell } from "@/app/components/wiki/use-wiki-shell";
import { WikiNavigation } from "@/app/components/wiki/wiki-navigation";
import { WIKI_SEARCH_EVENT } from "@/app/components/wiki/wiki-shell";
import { cn } from "@/app/lib/cn";

import type { WikiShellData } from "@/app/routes/wiki";

/** Browser storage entry that keeps on this device whether the column is collapsed. */
const COLLAPSED_STORAGE_KEY = "pages.wiki.treeColumn";

const COLLAPSED_VALUE = "collapsed";

/** Windows from which the page tree stands in its own column. */
const TREE_COLUMN_QUERY = "(min-width: 80rem)";

interface WikiTreePanelProps {
  readonly shell: Pick<WikiShellData, "navigation" | "templates" | "today">;
  /** Called when a link was followed, so a sheet can close. */
  readonly onNavigate?: () => void;
  readonly searchAddon?: React.ReactNode;
}

const collapseListeners = new Set<() => void>();

/** The collapsed state as last read or set; read from the storage on first use. */
let collapsedSnapshot: boolean | null = null;

function readStoredCollapsed(): boolean {
  try {
    return (
      window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === COLLAPSED_VALUE
    );
  } catch (error: unknown) {
    console.warn("Pages could not read the stored wiki column state.", error);
    return false;
  }
}

function getCollapsed(): boolean {
  collapsedSnapshot ??= readStoredCollapsed();

  return collapsedSnapshot;
}

/** The server and the hydrating render show the open column. */
function getServerCollapsed(): boolean {
  return false;
}

function notifyCollapseListeners(): void {
  for (const listener of collapseListeners) {
    listener();
  }
}

/** Follows a change made in another tab of the same browser. */
function handleStorage(event: StorageEvent): void {
  if (event.key !== COLLAPSED_STORAGE_KEY) {
    return;
  }

  collapsedSnapshot = readStoredCollapsed();
  notifyCollapseListeners();
}

function subscribeCollapsed(listener: () => void): () => void {
  if (collapseListeners.size === 0) {
    window.addEventListener("storage", handleStorage);
  }

  collapseListeners.add(listener);

  return () => {
    collapseListeners.delete(listener);

    if (collapseListeners.size === 0) {
      window.removeEventListener("storage", handleStorage);
    }
  };
}

function setCollapsed(isCollapsed: boolean): void {
  collapsedSnapshot = isCollapsed;

  try {
    window.localStorage.setItem(
      COLLAPSED_STORAGE_KEY,
      isCollapsed ? COLLAPSED_VALUE : "open",
    );
  } catch (error: unknown) {
    console.warn("Pages could not store the wiki column state.", error);
  }

  notifyCollapseListeners();
}

/**
 * Whether the person collapsed the column on this device.
 * @remarks
 * The column and the "Pages" button read the same state, so collapsing the
 * column shows the button at once and opening it from there hides it again.
 */
function useCollapsedColumn(): boolean {
  return useSyncExternalStore(
    subscribeCollapsed,
    getCollapsed,
    getServerCollapsed,
  );
}

/**
 * Search, new page and the page trees in a scroll area of their own: without
 * a visible scrollbar and with a transparent fade at the top and the bottom
 * where more rows wait, as in the chat list.
 */
function WikiTreePanel({
  shell,
  onNavigate,
  searchAddon,
}: WikiTreePanelProps): React.ReactElement {
  function handleSearch(): void {
    onNavigate?.();
    window.dispatchEvent(new Event(WIKI_SEARCH_EVENT));
  }

  return (
    <ScrollViewport
      containerClassName="min-h-0 flex-1"
      className="px-3 pt-3.5 pb-6"
      fadeMode="mask"
      hideScrollbar
    >
      <WikiNavigation
        navigation={shell.navigation}
        searchAddon={searchAddon}
        templates={shell.templates}
        today={shell.today}
        onNavigate={onNavigate}
        onSearch={handleSearch}
      />
    </ScrollViewport>
  );
}

/**
 * The page tree of the wiki in a column of its own between the main sidebar
 * and the page, in windows from 1280 px on.
 * @remarks
 * The column stays in place while wiki pages change and scrolls on its own.
 * The person can collapse it; the "Pages" button in the top row opens it
 * again. Narrower windows show the tree through that button as a sheet.
 */
export function WikiTreeColumn(): React.ReactElement | null {
  const { t } = useTranslation();
  const shell = useWikiShell();
  const isCollapsed = useCollapsedColumn();

  if (!shell || isCollapsed) {
    return null;
  }

  const collapseLabel = t("wiki.nav.collapseColumn");

  return (
    <aside
      aria-label={t("wiki.nav.pages")}
      className="fixed inset-y-0 left-(--app-sidebar-width) z-30 hidden w-(--wiki-tree-width) flex-col border-r border-border bg-background xl:flex"
      data-wiki-tree-column=""
    >
      <WikiTreePanel
        searchAddon={
          <Button
            aria-label={collapseLabel}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            size="icon-sm"
            title={collapseLabel}
            variant="ghost"
            onClick={() => setCollapsed(true)}
          >
            <ChevronsLeft aria-hidden="true" className="size-4" />
          </Button>
        }
        shell={shell}
      />
    </aside>
  );
}

/**
 * The "Pages" button in the top row of the wiki where the tree has no open
 * column: below 1280 px it opens the tree as a sheet over the page, which
 * Escape or a click beside it closes; from 1280 px on it opens the
 * collapsed column again.
 * @remarks
 * Phones keep the tree in the app menu below "Wiki" and show no button.
 */
export function WikiPagesButton(): React.ReactElement | null {
  const { t } = useTranslation();
  const shell = useWikiShell();
  const isCollapsed = useCollapsedColumn();
  const [isOpen, setIsOpen] = useState(false);

  // From 1280 px on the tree has its column; an open sheet would show it twice.
  useEffect(() => {
    const query = window.matchMedia(TREE_COLUMN_QUERY);

    function handleChange(event: MediaQueryListEvent): void {
      if (event.matches) {
        setIsOpen(false);
      }
    }

    query.addEventListener("change", handleChange);

    return () => query.removeEventListener("change", handleChange);
  }, []);

  if (!shell) {
    return null;
  }

  function handleOpen(): void {
    if (window.matchMedia(TREE_COLUMN_QUERY).matches) {
      setCollapsed(false);
      return;
    }

    setIsOpen(true);
  }

  return (
    <>
      <Button
        aria-haspopup="dialog"
        className={cn(
          "hidden text-sm md:ml-(--app-sidebar-gap) md:inline-flex xl:text-sm",
          !isCollapsed && "xl:hidden",
        )}
        size="sm"
        variant="outline"
        onClick={handleOpen}
      >
        <PanelLeftOpen aria-hidden="true" className="size-4" />
        {t("wiki.nav.pages")}
      </Button>
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent
          className="border-r border-border bg-background p-0"
          containerClassName="w-65"
        >
          <SheetTitle className="sr-only">{t("wiki.nav.pages")}</SheetTitle>
          <WikiTreePanel shell={shell} onNavigate={() => setIsOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}
