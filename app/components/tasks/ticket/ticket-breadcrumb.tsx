import { Link } from "react-router";
import { useTranslation } from "react-i18next";

import type { Project } from "@/definition/Project";
import type { WorkItemDetail } from "@/definition/Task";

interface TicketBreadcrumbProps {
  readonly backTarget: string;
  readonly project: Project;
  readonly ticket: WorkItemDetail;
  /** Visible ancestors from the initiative down to the parent. */
  readonly ancestors: readonly WorkItemDetail[];
  /** Builds the address of another ticket, keeping the view. */
  readonly hrefOf: (key: string) => string;
}

/** Renders the path from the task list through project and parents to the ticket. */
export function TicketBreadcrumb({
  backTarget,
  project,
  ticket,
  ancestors,
  hrefOf,
}: TicketBreadcrumbProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <nav aria-label={t("tasks.detail.breadcrumb")}>
      <ol className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <li>
          <Link
            className="hover:text-foreground hover:underline"
            to={backTarget}
            prefetch="intent"
          >
            {t("tasks.title")}
          </Link>
        </li>
        <li aria-hidden="true">›</li>
        <li>
          <Link
            className="hover:text-foreground hover:underline"
            to={`/projekte/${project.id}`}
            prefetch="intent"
          >
            {project.name}
          </Link>
        </li>
        {ancestors.map((ancestor) => (
          <li key={ancestor.id} className="flex min-w-0 items-center gap-1.5">
            <span aria-hidden="true">›</span>
            <Link
              className="max-w-48 truncate hover:text-foreground hover:underline"
              title={`${ancestor.key}: ${ancestor.title}`}
              to={hrefOf(ancestor.key)}
              prefetch="intent"
            >
              {ancestor.title}
            </Link>
          </li>
        ))}
        <li aria-hidden="true">›</li>
        <li aria-current="page" className="font-semibold text-foreground">
          {ticket.key}
        </li>
      </ol>
    </nav>
  );
}
