import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { ProjectDescription } from "@/app/components/projects/project-description";
import { ProjectNameHeading } from "@/app/components/projects/project-name-heading";
import { ProjectStatusPill } from "@/app/components/projects/project-status-pill";

import type { Project } from "@/definition/Project";

interface ProjectHeaderProps {
  readonly project: Project;
  readonly canWrite: boolean;
}

/** Renders the breadcrumb, icon, title, status, and description of a project. */
export function ProjectHeader({
  project,
  canWrite,
}: ProjectHeaderProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <>
      <Link
        to="/projekte"
        prefetch="intent"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t("projectDetail.breadcrumb")} › {project.name}
      </Link>

      <div className="mt-4 flex items-start gap-4">
        {project.hasIcon ? (
          <img
            className="size-16 shrink-0 rounded-2xl object-cover"
            src={`/projekte/${project.id}/icon`}
            alt=""
          />
        ) : (
          <span
            className="inline-flex size-16 shrink-0 select-none items-center justify-center rounded-2xl text-3xl font-semibold text-foreground"
            style={{ backgroundColor: project.placeholderColor }}
            aria-hidden="true"
          >
            {project.name.trim().charAt(0).toLocaleUpperCase()}
          </span>
        )}
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight text-foreground">
            <ProjectNameHeading name={project.name} canWrite={canWrite} />
            <ProjectStatusPill status={project.status} canWrite={canWrite} />
          </h1>
          <ProjectDescription
            description={project.description}
            canWrite={canWrite}
          />
        </div>
      </div>
    </>
  );
}
