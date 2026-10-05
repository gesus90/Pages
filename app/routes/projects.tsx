import { useTranslation } from "react-i18next";
import { useLoaderData } from "react-router";

import { CreateProjectDialog } from "@/app/components/projects/overview/create-project-dialog";
import { ProjectsContent } from "@/app/components/projects/overview/projects-content";
import { ProjectsToolbar } from "@/app/components/projects/overview/projects-toolbar";
import { useProjectListView } from "@/app/components/projects/overview/use-project-list-view";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { handleProjectOverviewAction } from "@/app/lib/project-overview-actions.server";
import { getApplicationServices } from "@/app/lib/services.server";

import type { ProjectActionResponse } from "@/app/lib/project-overview-actions.server";
import type { Project } from "@/definition/Project";
import type { Route } from "./+types/projects";

interface ProjectsLoaderData {
  readonly canManageProjects: boolean;
  readonly projects: readonly Project[];
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
    canManageProjects: services.projectService.canManageProjects(actor),
    projects,
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
  const { canManageProjects, projects } = useLoaderData<typeof loader>();
  const listView = useProjectListView(projects);

  return (
    <div className="mx-auto max-w-[92rem]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="select-none text-3xl font-semibold tracking-tight text-foreground xl:text-2xl">
              {t("projects.title")}
            </h1>
            <p className="mt-1.5 select-none text-sm text-muted-foreground">
              {t("projects.subtitle")}
            </p>
          </div>
          <CreateProjectDialog canManageProjects={canManageProjects} />
        </div>
        <ProjectsToolbar
          filter={listView.filter}
          search={listView.search}
          sortField={listView.sortField}
          onFilterChange={listView.setFilter}
          onSearchChange={listView.setSearch}
          onSortChange={listView.setSortField}
        />
        <ProjectsContent
          visibleProjects={listView.visibleProjects}
          hasProjects={projects.length > 0}
          canManageProjects={canManageProjects}
        />
      </div>
    </div>
  );
}
