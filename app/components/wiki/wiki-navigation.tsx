import {
  BookOpen,
  Clock,
  Home,
  Lock,
  Search,
  Star,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";

import { useWikiNavigation } from "@/app/components/wiki/use-wiki-navigation";
import { WikiMoveDialog } from "@/app/components/wiki/wiki-move-dialog";
import {
  NAVIGATION_LINK_CLASS,
  WikiLinkList,
  WikiTreeSection,
} from "@/app/components/wiki/wiki-navigation-sections";
import {
  WikiNewPageButton,
  WikiNewPageDialog,
} from "@/app/components/wiki/wiki-new-page-dialog";
import { buildWikiTree } from "@/app/lib/wiki-tree";

import type { WikiTemplateChoice } from "@/app/components/wiki/wiki-new-page-dialog";
import type {
  WikiNavigation as WikiNavigationData,
  WikiTreeNode,
} from "@/definition/Wiki";

interface WikiNavigationProps {
  readonly navigation: WikiNavigationData;
  readonly templates: readonly WikiTemplateChoice[];
  /** Today as `YYYY-MM-DD`, as the server sees it. */
  readonly today: string;
  /** Called when a link was followed, so a drawer can close. */
  readonly onNavigate?: () => void;
  /** Called to open the search. */
  readonly onSearch?: () => void;
  /** A control beside the search, such as the button that collapses the column. */
  readonly searchAddon?: React.ReactNode;
}

type SectionProps = Omit<
  React.ComponentProps<typeof WikiTreeSection>,
  "area" | "icon" | "items" | "title"
>;

function ProjectSections({
  navigation,
  section,
  tree,
}: {
  readonly navigation: WikiNavigationData;
  readonly section: SectionProps;
  readonly tree: ReturnType<typeof buildWikiTree>;
}): React.ReactElement {
  return (
    <>
      {navigation.projects.flatMap((project) => {
        const items = tree.projectRoots.get(project.id);

        return items
          ? [
              <WikiTreeSection
                key={project.id}
                {...section}
                area={{ projectId: project.id, scope: "project" }}
                icon={null}
                items={items}
                title={project.name}
              />,
            ]
          : [];
      })}
    </>
  );
}

/** The favorite pages that are still visible, in the stored order. */
function favoriteLinks(
  navigation: WikiNavigationData,
): React.ComponentProps<typeof WikiLinkList>["links"] {
  const byId = new Map(navigation.nodes.map((node) => [node.id, node]));

  return navigation.favoriteIds.flatMap((id) => {
    const node = byId.get(id);

    return node ? [{ icon: node.icon, id, title: node.title }] : [];
  });
}

/** Search, new page and the start page at the top of the navigation. */
function NavigationActions({
  navigation,
  templates,
  onNavigate,
  onSearch,
  searchAddon,
}: Pick<
  WikiNavigationProps,
  "navigation" | "templates" | "onNavigate" | "onSearch" | "searchAddon"
>): React.ReactElement {
  const { t } = useTranslation();
  const { pathname } = useLocation();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <button
          aria-keyshortcuts="Control+K Meta+K"
          className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[0.625rem] border border-border bg-surface px-3 text-sm text-muted-foreground hover:bg-surface-hover"
          type="button"
          onClick={onSearch}
        >
          <Search aria-hidden="true" className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left">
            {t("wiki.nav.search")}
          </span>
          <kbd className="shrink-0 font-sans text-xs text-muted-foreground">
            {t("wiki.nav.searchShortcut")}
          </kbd>
        </button>
        {searchAddon}
      </div>
      {navigation.canCreate ? (
        <WikiNewPageButton
          key={pathname}
          className="w-full rounded-[0.625rem] text-sm xl:text-sm"
          label={t("wiki.nav.newPage")}
          projects={navigation.projects}
          templates={templates}
        />
      ) : null}
      <Link className={NAVIGATION_LINK_CLASS} to="/wiki" onClick={onNavigate}>
        <Home aria-hidden="true" className="size-4" />
        {t("wiki.nav.home")}
      </Link>
    </div>
  );
}

/** The left navigation of the wiki: search, new page, favorites and trees. */
export function WikiNavigation({
  navigation,
  templates,
  today,
  onNavigate,
  onSearch,
  searchAddon,
}: WikiNavigationProps): React.ReactElement {
  const { t } = useTranslation();
  const location = useLocation();
  const state = useWikiNavigation(navigation);
  // The tree column stays while pages change, so the dialog remembers the
  // navigation it was opened in and closes with the next one, also when the
  // person comes back to the same page.
  const [childRequest, setChildRequest] = useState<{
    readonly parent: WikiTreeNode;
    readonly locationKey: string;
  } | null>(null);
  const childParent =
    childRequest?.locationKey === location.key ? childRequest.parent : null;
  const tree = buildWikiTree(navigation.nodes);
  const favorites = favoriteLinks(navigation);
  const section = {
    currentId: state.currentId,
    drag: state.drag,
    expandedIds: state.expandedIds,
    onCreateChild: navigation.canCreate
      ? (parent: WikiTreeNode) =>
          setChildRequest({ locationKey: location.key, parent })
      : undefined,
    onNavigate,
    onToggle: state.onToggle,
    today,
  };

  return (
    <nav aria-label={t("wiki.nav.label")} className="flex flex-col gap-2">
      <NavigationActions
        navigation={navigation}
        templates={templates}
        searchAddon={searchAddon}
        onNavigate={onNavigate}
        onSearch={onSearch}
      />
      <WikiLinkList
        icon={<Star aria-hidden="true" className="size-3.5" />}
        links={favorites}
        title={t("wiki.nav.favorites")}
        onNavigate={onNavigate}
      />
      <WikiLinkList
        icon={<Clock aria-hidden="true" className="size-3.5" />}
        links={navigation.recent}
        title={t("wiki.nav.recent")}
        onNavigate={onNavigate}
      />
      <WikiTreeSection
        {...section}
        area={{ projectId: null, scope: "private" }}
        icon={<Lock aria-hidden="true" className="size-3.5" />}
        items={tree.privateRoots}
        title={t("wiki.nav.privateArea")}
      />
      <WikiTreeSection
        {...section}
        area={{ projectId: null, scope: "instance" }}
        icon={<BookOpen aria-hidden="true" className="size-3.5" />}
        items={tree.instanceRoots}
        title={t("wiki.nav.generalArea")}
      />
      <ProjectSections navigation={navigation} section={section} tree={tree} />
      {navigation.nodes.length === 0 ? (
        <p className="px-2 text-sm text-muted-foreground">
          {t("wiki.nav.empty")}
        </p>
      ) : null}
      <Link
        className={NAVIGATION_LINK_CLASS}
        to="/wiki/trash"
        onClick={onNavigate}
      >
        <Trash2 aria-hidden="true" className="size-4" />
        {t("wiki.nav.trash")}
      </Link>
      <WikiNewPageDialog
        key={childParent?.id ?? "none"}
        isOpen={childParent !== null}
        parentId={childParent?.id}
        projects={navigation.projects}
        templates={templates}
        // The dialog only opens through the plus, so any change closes it.
        onOpenChange={() => setChildRequest(null)}
      />
      {state.pendingMove ? (
        <WikiMoveDialog
          navigation={navigation}
          request={state.pendingMove}
          onClose={state.closeMove}
        />
      ) : null}
    </nav>
  );
}
