import { useTranslation } from "react-i18next";

import { PROJECT_STATUS } from "@/definition/Project";

import type { ProjectStatus } from "@/definition/Project";

interface ProjectStatusBadgeProps {
  readonly status: ProjectStatus;
}

function getStatusDotClassName(status: ProjectStatus): string {
  switch (status) {
    case PROJECT_STATUS.PLANNED:
      return "bg-primary";
    case PROJECT_STATUS.ACTIVE:
      return "bg-emerald-500";
    case PROJECT_STATUS.PAUSED:
      return "bg-amber-500";
    case PROJECT_STATUS.COMPLETED:
      return "bg-slate-400";
  }
}

/** Renders the status of a project as a colored dot with its label. */
export function ProjectStatusBadge({
  status,
}: ProjectStatusBadgeProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
      <span
        className={`size-2 rounded-full ${getStatusDotClassName(status)}`}
        aria-hidden="true"
      />
      {t(`projects.status.${status}`)}
    </span>
  );
}
