import { Link } from "react-router";
import { useTranslation } from "react-i18next";

import type { Project } from "@/definition/Project";
import type { WorkItemDetail } from "@/definition/Task";

interface TicketBreadcrumbProps {
  readonly backTarget: string;
  readonly project: Project;
  readonly ticket: WorkItemDetail;
}

/** Renders the path from the task list through the project to the ticket. */
export function TicketBreadcrumb({
  backTarget,
  project,
  ticket,
}: TicketBreadcrumbProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <nav
      aria-label={t("tasks.detail.breadcrumb")}
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
    >
      <Link
        className="hover:text-foreground hover:underline"
        to={backTarget}
        prefetch="intent"
      >
        {t("tasks.title")}
      </Link>
      <span aria-hidden="true">›</span>
      <Link
        className="hover:text-foreground hover:underline"
        to={`/projekte/${project.id}`}
        prefetch="intent"
      >
        {project.name}
      </Link>
      <span aria-hidden="true">›</span>
      <span className="font-semibold text-foreground">{ticket.key}</span>
    </nav>
  );
}
