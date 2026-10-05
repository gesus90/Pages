import { CalendarDays, MoreHorizontal, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { ProjectIcon } from "@/app/components/projects/overview/project-icon";
import { ProjectStatusBadge } from "@/app/components/projects/overview/project-status-badge";

import type { Project } from "@/definition/Project";

interface ProjectCardProps {
  readonly project: Project;
}

/** Renders a project of the overview as a card that links to its page. */
export function ProjectCard({ project }: ProjectCardProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <article className="relative rounded-2xl bg-surface p-6 shadow-card transition-shadow hover:shadow-floating">
      <Link
        className="absolute inset-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        to={`/projekte/${encodeURIComponent(project.id)}`}
        prefetch="intent"
        aria-label={project.name}
      />
      <div className="relative pointer-events-none flex items-start justify-between gap-3">
        <ProjectIcon project={project} />
        <span className="pointer-events-auto relative" aria-hidden="true">
          <MoreHorizontal
            className="size-5 select-none text-muted-foreground"
            aria-hidden="true"
          />
        </span>
      </div>
      <div className="pointer-events-none mt-4">
        <h2 className="text-lg font-semibold text-foreground">
          {project.name}
        </h2>
        <p className="mt-1 line-clamp-2 min-h-10 text-sm leading-relaxed text-muted-foreground">
          {project.description || t("projects.noDescription")}
        </p>
        <div className="mt-5 flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${project.progress}%` }}
            />
          </div>
          <span className="text-sm font-medium text-foreground">
            {project.progress} %
          </span>
        </div>
        <div className="mt-4 flex items-start justify-between gap-3">
          <ProjectStatusBadge status={project.status} />
          <span className="shrink-0 text-right text-xs leading-snug text-muted-foreground">
            <span className="block">{t("projects.updatedAt")}</span>
            <span className="block">{project.updatedAt}</span>
          </span>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 pt-3 text-xs text-muted-foreground">
          {project.managerName ? (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <Users className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{project.managerName}</span>
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
            {t("projects.createdAt")} {project.createdAt}
          </span>
        </div>
      </div>
    </article>
  );
}
