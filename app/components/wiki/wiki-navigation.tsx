import {
  BookOpen,
  Clock,
  Home,
  Lock,
  Search,
  Star,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";

import { useWikiNavigation } from "@/app/components/wiki/use-wiki-navigation";
import { WikiMoveDialog } from "@/app/components/wiki/wiki-move-dialog";
import {
  NAVIGATION_LINK_CLASS,
  WikiLinkList,
  WikiTreeSection,
} from "@/app/components/wiki/wiki-navigation-sections";
import { WikiNewPageButton } from "@/app/components/wiki/wiki-new-page-dialog";
import { buildWikiTree } from "@/app/lib/wiki-tree";

import type { WikiTemplateChoice } from "@/app/components/wiki/wiki-new-page-dialog";
import type { WikiNavigation as WikiNavigationData } from "@/definition/Wiki";

interface WikiNavigationProps {
  readonly navigation: WikiNavigationData;
  readonly templates: readonly WikiTemplateChoice[];
  /** Today as `YYYY-MM-DD`, as the server sees it. */
  readonly today: string;
  /** Called when a link was followed, so a drawer can close. */
  readonly onNavigate?: () => void;
  /** Called to open the search. */
  readonly onSearch?: () => void;
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

/** The left navigation of the wiki: search, new page, favorites and trees. */
export function WikiNavigation({
  navigation,
  templates,
  today,
  onNavigate,
  onSearch,
}: WikiNavigationProps): React.ReactElement {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const state = useWikiNavigation(navigation);
  const tree = buildWikiTree(navigation.nodes);
  const byId = new Map(navigation.nodes.map((node) => [node.id, node]));
  const favorites = navigation.favoriteIds.flatMap((id) => {
    const node = byId.get(id);

    return node ? [{ icon: node.icon, id, title: node.title }] : [];
  });
  const section = {
    currentId: state.currentId,
    drag: state.drag,
    expandedIds: state.expandedIds,
    onNavigate,
    onToggle: state.onToggle,
    today,
  };

  return (
    <nav aria-label={t("wiki.nav.label")} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <button
          className="flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm text-muted-foreground hover:bg-surface-hover"
          type="button"
          onClick={onSearch}
        >
          <Search aria-hidden="true" className="size-4" />
          {t("wiki.nav.search")}
        </button>
        {navigation.canCreate ? (
          <WikiNewPageButton
            key={pathname}
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
