import { Columns3, ListTree } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useRouteLoaderData } from "react-router";

import { cn } from "@/app/lib/cn";
import { TICKET_LAYOUT_ROUTE_ID } from "@/app/lib/ticket-tree";

import { ProjectRow, TreeChildren } from "./ticket-tree-rows";
import { useTicketTree } from "./use-ticket-tree";

import type { loader as tasksLoader } from "@/app/routes/tasks";
import type { TicketLayoutData } from "@/app/routes/tasks-layout";
import type { TreeRowContext } from "./ticket-tree-rows";

interface TicketSidebarSectionProps {
  /** Called when a link was followed, so the mobile menu can close. */
  readonly onNavigate?: () => void;
}

/** The board view the address or the saved preferences show, if a board is open. */
function useBoardView(): string | null {
  const { ticketKey } = useParams();
  const german = useRouteLoaderData<typeof tasksLoader>("aufgaben");
  const english = useRouteLoaderData<typeof tasksLoader>("tasks");
  const board = german ?? english;

  return ticketKey === undefined && board ? board.board.view : null;
}

interface ViewLinkProps {
  readonly to: string;
  readonly icon: typeof Columns3;
  readonly label: string;
  readonly isActive: boolean;
  readonly onNavigate?: () => void;
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
          ? "bg-primary-subtle text-foreground"
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
 * sidebar, shown on every ticket page (A8 §2, A8.2-E08): Kanban board,
 * hierarchy and the tree Initiative → Epic → Task → Subtask.
 *
 * @remarks
 * It reads the data the ticket layout already loaded, so the sidebar needs
 * no request of its own; the mobile menu shows the same section.
 */
export function TicketSidebarSection({
  onNavigate,
}: TicketSidebarSectionProps): React.ReactElement | null {
  const layout = useRouteLoaderData<TicketLayoutData>(TICKET_LAYOUT_ROUTE_ID);

  if (!layout) {
    return null;
  }

  return (
    <div className="pages-hover-scrollbar mt-1 ml-4 min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto border-l border-border pl-2">
      <TicketNavigation layout={layout} onNavigate={onNavigate} />
    </div>
  );
}
