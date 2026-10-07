import { useTranslation } from "react-i18next";
import { useLoaderData, useSearchParams } from "react-router";

import { CreateProjectDialog } from "@/app/components/projects/overview/create-project-dialog";
import { ProjectsContent } from "@/app/components/projects/overview/projects-content";
import { ProjectsToolbar } from "@/app/components/projects/overview/projects-toolbar";
import { ArchivedProjectsContent } from "@/app/components/projects/overview/archived-projects-content";
import { SegmentedControl } from "@/app/components/ui/segmented-control";
import { useProjectListView } from "@/app/components/projects/overview/use-project-list-view";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { handleProjectOverviewAction } from "@/app/lib/project-overview-actions.server";
import { getApplicationServices } from "@/app/lib/services.server";

import type { ProjectActionResponse } from "@/app/lib/project-overview-actions.server";
import type { Project } from "@/definition/Project";
import type { ProjectTemplate } from "@/definition/Project";
import type { ProjectDepartmentChoices } from "@/definition/Project";
import type { Route } from "./+types/projects";

interface ProjectsLoaderData {
  readonly templates: readonly ProjectTemplate[];
  readonly archivedProjects: readonly Project[];
  readonly canDeleteProjects: boolean;
  readonly canManageProjects: boolean;
  readonly projects: readonly Project[];
  readonly departmentChoices: ProjectDepartmentChoices;
}

/** Loads projects from the database for server-side rendering. */
export async function loader({
  context,
}: Route.LoaderArgs): Promise<ProjectsLoaderData> {
  const actor = context.get(authenticatedUserContext);

  if (!actor) {
    throw new Error("Authenticated middleware did not provide a user.");
  }

  const services = await getApplicationServices();
  const projects = await services.projectService.findAll(actor);

  return {
    templates: await services.projectService.findTemplates(actor),
    archivedProjects: await services.projectService.findArchived(actor),
    canDeleteProjects: await services.projectService.canDeleteProjects(actor),
    canManageProjects: await services.projectService.canCreateProjects(actor),
    projects,
    departmentChoices: await services.projectService.departmentChoices(actor),
  };
}

/** Creates projects through the persistent service layer. */
export async function action({
  context,
  request,
}: Route.ActionArgs): Promise<ProjectActionResponse> {
  if (request.method !== "POST") {
    throw new Response("Method Not Allowed", {
      headers: { Allow: "POST" },
      status: 405,
    });
  }

  const actor = context.get(authenticatedUserContext);

  if (!actor) {
    throw new Response("Forbidden", { status: 403 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent");
  const services = await getApplicationServices();

  return handleProjectOverviewAction(intent, { actor, formData, services });
}

/** Renders the responsive, database-backed project overview. */
export default function ProjectsRoute(): React.ReactElement {
  const { t } = useTranslation();
  const {
    canManageProjects,
    projects,
    departmentChoices,
    archivedProjects,
    canDeleteProjects,
    templates,
  } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const isArchive = searchParams.get("archiv") === "1";
  const listView = useProjectListView(isArchive ? archivedProjects : projects);
  function handleScope(scope: "active" | "archive"): void {
    setSearchParams(scope === "archive" ? { archiv: "1" } : {});
    listView.resetFilters();
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh-8.5rem)] min-h-0 max-w-[92rem] flex-col">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground xl:text-2xl">
              {t("projects.title")}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {t("projects.subtitle")}
            </p>
          </div>
          <CreateProjectDialog
            canManageProjects={canManageProjects}
            departmentChoices={departmentChoices}
            templates={templates}
          />
        </div>
        <div className="mt-5 shrink-0">
          <SegmentedControl
            value={isArchive ? "archive" : "active"}
            onValueChange={handleScope}
            ariaLabel={t("projects.lifecycle.view")}
            options={[
              { value: "active", label: t("projects.lifecycle.active") },
              { value: "archive", label: t("projects.lifecycle.archiveView") },
            ]}
          />
        </div>
        <ProjectsToolbar
          departments={listView.departments}
          departmentId={listView.departmentId}
          onDepartmentChange={listView.setDepartmentId}
          filter={listView.filter}
          search={listView.search}
          sortField={listView.sortField}
          onFilterChange={listView.setFilter}
          onSearchChange={listView.setSearch}
          onSortChange={listView.setSortField}
        />
        {isArchive ? (
          <ArchivedProjectsContent
            projects={listView.visibleProjects}
            canDelete={canDeleteProjects}
          />
        ) : (
          <ProjectsContent
            onResetFilters={listView.resetFilters}
            visibleProjects={listView.visibleProjects}
            hasProjects={projects.length > 0}
            canManageProjects={canManageProjects}
            departmentChoices={departmentChoices}
            templates={templates}
          />
        )}
      </div>
    </div>
  );
}
