import { useTranslation } from "react-i18next";
import { useLoaderData, useSearchParams } from "react-router";

import { CreateProjectDialog } from "@/app/components/projects/overview/create-project-dialog";
import { ProjectsContent } from "@/app/components/projects/overview/projects-content";
import { ProjectsToolbar } from "@/app/components/projects/overview/projects-toolbar";
import { ArchivedProjectsContent } from "@/app/components/projects/overview/archived-projects-content";
import { SegmentedControl } from "@/app/components/ui/segmented-control";
import { useProjectListView } from "@/app/components/projects/overview/use-project-list-view";
import { useLocalStateRoute } from "@/app/components/common/use-local-state-route";
import {
  isCurrentLocalStateAudience,
  isLocalStateAudience,
} from "@/app/lib/local-state/local-state-audience";
import {
  loadLocalFirst,
  localStateRoute,
} from "@/app/lib/local-state/local-state-loader";
import { readRouteData } from "@/app/lib/local-state/route-data";
import { sendToBackend } from "@/app/lib/backend-request";

import type { LocalStateRouteKind } from "@/app/components/common/use-local-state-route";
import type { LocalStateAudience } from "@/app/lib/local-state/local-state-audience";
import type { WithLocalState } from "@/app/lib/local-state/local-state-loader";
import type { Project } from "@/definition/Project";
import type { ProjectTemplate } from "@/definition/Project";
import type { ProjectDepartmentChoices } from "@/definition/Project";
import type { Route } from "./+types/projects";

/** The overview as its endpoint answers it. */
export interface ProjectsLoaderData {
  readonly templates: readonly ProjectTemplate[];
  readonly archivedProjects: readonly Project[];
  readonly canDeleteProjects: boolean;
  readonly canManageProjects: boolean;
  readonly projects: readonly Project[];
  readonly departmentChoices: ProjectDepartmentChoices;
  readonly audience: LocalStateAudience;
}

function isProjectsLoaderData(value: unknown): value is ProjectsLoaderData {
  return (
    typeof value === "object" &&
    value !== null &&
    "projects" in value &&
    Array.isArray(value.projects) &&
    "archivedProjects" in value &&
    Array.isArray(value.archivedProjects) &&
    "templates" in value &&
    Array.isArray(value.templates) &&
    "audience" in value &&
    isLocalStateAudience(value.audience)
  );
}

/** The project overview, kept per account, rights and address. */
const PROJECTS_PAGE_STATE: LocalStateRouteKind<ProjectsLoaderData> = {
  schemaVersion: 1,
  isPayload: isProjectsLoaderData,
  isCurrent: (page) => isCurrentLocalStateAudience(page.audience),
  ownerOf: (page) => page.audience.userId,
  isRefused: () => false,
};

/**
 * Opens the overview from the account's kept answer at once and asks the endpoint behind it.
 *
 * @remarks
 * The endpoint runs the server loader with its permission checks.
 */
export async function clientLoader({
  request,
}: Route.ClientLoaderArgs): Promise<WithLocalState<ProjectsLoaderData>> {
  const url = new URL(request.url);
  return loadLocalFirst(localStateRoute(url), PROJECTS_PAGE_STATE, () =>
    readRouteData({
      endpoint: `/projekte-api/list${url.search}`,
      signal: request.signal,
      isPayload: isProjectsLoaderData,
    }),
  );
}

/** Sends a change of the overview to the API, which runs the overview's action. */
export async function clientAction({
  request,
}: Route.ClientActionArgs): Promise<unknown> {
  return sendToBackend(request);
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
  } = useLocalStateRoute(
    useLoaderData<typeof clientLoader>(),
    PROJECTS_PAGE_STATE,
  );
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
