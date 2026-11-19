import { Columns3, ListTree } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useFetcher, useParams, useRouteLoaderData } from "react-router";

import {
  createLocalStateLayoutAnswers,
  useLocalStateLayout,
} from "@/app/components/common/use-local-state-layout";
import { ScrollViewport } from "@/app/components/ui/scroll-viewport";
import { cn } from "@/app/lib/cn";
import {
  buildTicketTree,
  findTreePath,
  TICKET_LAYOUT_ROUTE_ID,
} from "@/app/lib/ticket-tree";
import {
  readTicketTree,
  TICKET_TREE_ENDPOINT,
  TICKET_TREE_STATE,
} from "@/app/lib/ticket-tree-state";

import { ProjectRow, TreeChildren } from "./ticket-tree-rows";

import type { LocalStateLayoutSource } from "@/app/components/common/use-local-state-layout";
import type { WithLocalState } from "@/app/lib/local-state/local-state-loader";
import type { TicketTreeProject } from "@/app/lib/ticket-tree";
import type { TicketLayoutData } from "@/app/routes/tasks-layout";
import type { loader as tasksLoader } from "@/app/routes/tasks-server";
import type { TicketTreeEntry } from "@/definition/Task";
import type { TreeRowContext } from "./ticket-tree-rows";

/** The tree's kept answers do not depend on the address. */
const TICKET_TREE_SOURCE: LocalStateLayoutSource<TicketLayoutData> = {
  route: TICKET_TREE_ENDPOINT,
  read: readTicketTree,
  answers: createLocalStateLayoutAnswers(),
};

interface TicketSidebarSectionProps {
  /** Called when a link was followed, so the mobile menu can close. */
  readonly onNavigate?: () => void;
}

interface TicketTreeState {
  readonly projects: readonly TicketTreeProject<TicketTreeEntry>[];
  readonly currentId: string | null;
  readonly expandedKeys: ReadonlySet<string>;
  readonly onToggle: (nodeKey: string) => void;
}

interface ViewLinkProps {
  readonly to: string;
  readonly icon: typeof Columns3;
  readonly label: string;
  readonly isActive: boolean;
  readonly onNavigate?: () => void;
}

function useTicketTree(layout: TicketLayoutData): TicketTreeState {
  const { ticketKey = null } = useParams();
  const fetcher = useFetcher();
  const current = layout.entries.find((entry) => entry.key === ticketKey);
  const path = findTreePath(layout.entries, current?.id ?? null);
  const pathKey = path.join("|");
  const [opened, setOpened] = useState<ReadonlySet<string>>(
    () => new Set([...layout.expandedKeys, ...path]),
  );
  const [shownPath, setShownPath] = useState(pathKey);

  // Another ticket opened: show its path as well (state adjusted while
  // rendering, as React recommends instead of an effect).
  if (shownPath !== pathKey) {
    setShownPath(pathKey);
    setOpened((previous) => new Set([...previous, ...path]));
  }

  function handleToggle(nodeKey: string): void {
    const isOpen = !opened.has(nodeKey);
    const next = new Set(opened);

    if (isOpen) {
      next.add(nodeKey);
    } else {
      next.delete(nodeKey);
    }

    setOpened(next);
    void fetcher.submit(
      { expanded: isOpen ? "1" : "0", intent: "set-tree-expanded", nodeKey },
      { action: "/aufgaben", method: "post" },
    );
  }

  return {
    currentId: current?.id ?? null,
    expandedKeys: opened,
    onToggle: handleToggle,
    projects: buildTicketTree(layout.entries),
  };
}

/** The board view the address or the saved preferences show, if a board is open. */
function useBoardView(): string | null {
  const { ticketKey } = useParams();
  const german = useRouteLoaderData<typeof tasksLoader>("aufgaben");
  const english = useRouteLoaderData<typeof tasksLoader>("tasks");
  const board = german ?? english;

  return ticketKey === undefined && board ? board.board.view : null;
}

function ViewLink({
  to,
  icon: Icon,
  label,
  isActive,
  onNavigate,
}: ViewLinkProps): React.ReactElement {
  return (
    <Link
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "flex min-h-9 items-center gap-2 rounded-lg px-2 text-sm md:min-h-8",
        isActive
          ? "bg-sidebar-active text-foreground inset-shadow-navigation-selection"
          : "text-muted-foreground hover:bg-sidebar-hover hover:text-foreground",
      )}
      prefetch="intent"
      to={to}
      onClick={onNavigate}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      {label}
    </Link>
  );
}

/** The quick entries and the four-level ticket tree. */
function TicketNavigation({
  layout,
  onNavigate,
}: {
  readonly layout: TicketLayoutData;
  readonly onNavigate?: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const tree = useTicketTree(layout);
  const view = useBoardView();
  const context: TreeRowContext = { ...tree, onNavigate };
  const [single] = tree.projects;

  return (
    <nav aria-label={t("tasks.tree.label")} className="flex flex-col gap-0.5">
      <ViewLink
        icon={Columns3}
        isActive={view === "kanban"}
        label={t("tasks.tree.kanban")}
        to="/aufgaben?view=kanban"
        onNavigate={onNavigate}
      />
      <ViewLink
        icon={ListTree}
        isActive={view === "hierarchy"}
        label={t("tasks.tree.hierarchy")}
        to="/aufgaben?view=hierarchy"
        onNavigate={onNavigate}
      />
      {single === undefined ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">
          {t("tasks.tree.empty")}
        </p>
      ) : null}
      {single !== undefined && tree.projects.length === 1 ? (
        <TreeChildren context={context} depth={0} nodes={single.nodes} />
      ) : null}
      {tree.projects.length > 1 ? (
        <ul>
          {tree.projects.map((project) => (
            <ProjectRow
              key={project.key}
              context={context}
              name={project.projectName}
              nodes={project.nodes}
              projectKey={project.key}
            />
          ))}
        </ul>
      ) : null}
    </nav>
  );
}

/**
 * The ticket navigation as indented section below "Aufgaben" in the main
 * sidebar, shown on every ticket page: Kanban board,
 * hierarchy and the tree Initiative → Epic → Task → Subtask.
 * @remarks
 * It reads the data the ticket layout already loaded, so the sidebar needs
 * no request of its own; the mobile menu shows the same section.
 */
export function TicketSidebarSection({
  onNavigate,
}: TicketSidebarSectionProps): React.ReactElement | null {
  const layout = useLocalStateLayout(
    useRouteLoaderData<WithLocalState<TicketLayoutData>>(
      TICKET_LAYOUT_ROUTE_ID,
    ),
    TICKET_TREE_STATE,
    TICKET_TREE_SOURCE,
  );

  if (!layout) {
    return null;
  }

  return (
    <ScrollViewport
      axis="vertical"
      containerClassName="pages-sidebar-tree mt-1 ml-4 min-h-0 min-w-0"
      className="overflow-x-hidden overflow-y-auto border-l border-border pl-2"
    >
      <TicketNavigation layout={layout} onNavigate={onNavigate} />
    </ScrollViewport>
  );
}
