import { FolderPlus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { CreateProjectDialog } from "@/app/components/projects/overview/create-project-dialog";
import { ProjectCard } from "@/app/components/projects/overview/project-card";
import { ProjectGridScrollArea } from "@/app/components/projects/overview/project-grid-scroll-area";

import type { Project } from "@/definition/Project";

interface ProjectsContentProps {
  readonly visibleProjects: readonly Project[];
  /** Whether the visitor may see any project, before filtering. */
  readonly hasProjects: boolean;
  readonly canManageProjects: boolean;
}

/**
 * Renders the project cards, or the reason there are none.
 *
 * @remarks
 * Without any project the empty state offers to create the first one; with
 * projects that are all filtered out, it only says nothing matched.
 */
export function ProjectsContent({
  visibleProjects,
  hasProjects,
  canManageProjects,
}: ProjectsContentProps): React.ReactElement {
  const { t } = useTranslation();

  if (visibleProjects.length) {
    return (
      <ProjectGridScrollArea>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-6">
          {visibleProjects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      </ProjectGridScrollArea>
    );
  }

  if (hasProjects) {
    return (
      <div className="mt-8 rounded-2xl bg-muted/40 p-10 text-center text-sm text-muted-foreground">
        {t("projects.noMatches")}
      </div>
    );
  }

  return (
    <div className="mt-8 flex flex-col items-center rounded-2xl bg-muted/40 px-6 py-16 text-center">
      <FolderPlus className="size-10 text-primary" aria-hidden="true" />
      <h2 className="mt-4 select-none text-lg font-semibold">
        {t("projects.empty.title")}
      </h2>
      <p className="mt-2 max-w-sm select-none text-sm leading-relaxed text-muted-foreground">
        {t("projects.empty.description")}
      </p>
      <div className="mt-5">
        <CreateProjectDialog canManageProjects={canManageProjects} />
      </div>
    </div>
  );
}
