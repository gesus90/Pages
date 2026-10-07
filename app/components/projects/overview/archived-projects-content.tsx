import { useTranslation } from "react-i18next";

import { ProjectDepartmentChips } from "@/app/components/projects/project-department-chips";
import { ProjectLifecycleDialog } from "@/app/components/projects/project-lifecycle-dialog";
import { ProjectGridScrollArea } from "./project-grid-scroll-area";

import type { Project } from "@/definition/Project";

interface ArchivedProjectsContentProps {
  readonly projects: readonly Project[];
  readonly canDelete: boolean;
}

/** Shows retained archive metadata without opening active project content. */
export function ArchivedProjectsContent({
  projects,
  canDelete,
}: ArchivedProjectsContentProps): React.ReactElement {
  const { t } = useTranslation();
  if (projects.length === 0)
    return (
      <p className="mt-8 rounded-2xl bg-muted/40 p-8 text-center text-sm text-muted-foreground">
        {t("projects.lifecycle.archiveEmpty")}
      </p>
    );
  return (
    <ProjectGridScrollArea>
      <div className="flex flex-col gap-3">
        {projects.map((project) => (
          <article
            key={project.id}
            className="flex flex-wrap items-start justify-between gap-4 rounded-2xl bg-surface p-5 shadow-xs"
          >
            <div className="min-w-0 flex-1">
              <h2 className="break-words text-lg font-semibold">
                {project.name}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {project.description}
              </p>
              <div className="mt-3">
                <ProjectDepartmentChips departments={project.departments} />
              </div>
            </div>
            {canDelete ? (
              <ProjectLifecycleDialog
                projectId={project.id}
                name={project.name}
                kind="delete"
                action={`/projekte/${encodeURIComponent(project.id)}`}
              />
            ) : null}
          </article>
        ))}
      </div>
    </ProjectGridScrollArea>
  );
}
