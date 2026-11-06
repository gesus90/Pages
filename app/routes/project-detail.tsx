import { useTranslation } from "react-i18next";
import { useLoaderData, useSearchParams } from "react-router";

import { ProjectActivityTab } from "@/app/components/projects/project-activity-tab";
import { ProjectHeader } from "@/app/components/projects/project-header";
import { ProjectGeneralTab } from "@/app/components/projects/project-general-tab";
import { ProjectIntegrationsTab } from "@/app/components/projects/project-integrations-tab";
import { ProjectPlanningTab } from "@/app/components/projects/project-planning-tab";
import { ProjectTeamTab } from "@/app/components/projects/project-team-tab";
import { Tabs } from "@/app/components/ui/tabs";
import { HorizontalScrollArea } from "@/app/components/ui/horizontal-scroll-area";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";
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
import type { ProjectMember } from "@/definition/Project";
import type { Project } from "@/definition/Project";
import type {
  ProjectActionPermissions,
  ProjectDepartmentChoices,
} from "@/definition/Project";
import type { ProjectActivity } from "@/definition/Project";
import type { ProjectEvent } from "@/definition/Project";
import type { ProjectGoal } from "@/definition/Project";
import type { ProjectIntegration } from "@/definition/Project";
import type {
  Milestone,
  MilestoneDependency,
  WorkItemDetail,
  WorkItemHistory,
  WorkflowStatus,
} from "@/definition/Task";
import type { User } from "@/definition/User";
import type { Route } from "./+types/project-detail";

/** The tabs of the project page, in their order. */
export const DETAIL_TABS = [
  "general",
  "team",
  "planning",
  "integrations",
  "activity",
] as const;

/** One tab of the project page. */
export type DetailTab = (typeof DETAIL_TABS)[number];

/** The project page as its endpoint answers it. */
export interface ProjectDetailLoaderData {
  readonly permissions: ProjectActionPermissions;
  readonly departmentChoices: ProjectDepartmentChoices;
  readonly project: Project;
  readonly members: readonly ProjectMember[];
  readonly eligibleUsers: readonly User[];
  readonly goals: readonly ProjectGoal[];
  readonly tags: readonly string[];
  readonly events: readonly ProjectEvent[];
  readonly milestones: readonly Milestone[];
  readonly milestoneLinks: readonly MilestoneDependency[];
  readonly statuses: readonly WorkflowStatus[];
  readonly workItems: readonly WorkItemDetail[];
  readonly integration: ProjectIntegration | null;
  readonly discordConnected: boolean;
  readonly activity: readonly ProjectActivity[];
  readonly taskHistory: readonly WorkItemHistory[];
  readonly canWrite: boolean;
  /** Whether the visitor may archive the milestones of this project. */
  readonly canArchiveMilestones: boolean;
  readonly activeTab: DetailTab;
  readonly audience: LocalStateAudience;
}

function isProjectDetailLoaderData(
  value: unknown,
): value is ProjectDetailLoaderData {
  return (
    typeof value === "object" &&
    value !== null &&
    "project" in value &&
    typeof value.project === "object" &&
    value.project !== null &&
    "permissions" in value &&
    typeof value.permissions === "object" &&
    "activeTab" in value &&
    typeof value.activeTab === "string" &&
    "audience" in value &&
    isLocalStateAudience(value.audience)
  );
}

/** The project page, kept per account, rights, project and tab. */
const PROJECT_DETAIL_STATE: LocalStateRouteKind<ProjectDetailLoaderData> = {
  schemaVersion: 1,
  isPayload: isProjectDetailLoaderData,
  isCurrent: (page) => isCurrentLocalStateAudience(page.audience),
  ownerOf: (page) => page.audience.userId,
  isRefused: () => false,
};

/**
 * Opens the project from the account's kept answer at once and asks the endpoint behind it.
 *
 * @remarks
 * The endpoint runs the server loader with its permission checks; a missing
 * or refused project shows the same error page as before.
 */
export async function clientLoader({
  params,
  request,
}: Route.ClientLoaderArgs): Promise<WithLocalState<ProjectDetailLoaderData>> {
  const url = new URL(request.url);
  return loadLocalFirst(localStateRoute(url), PROJECT_DETAIL_STATE, () =>
    readRouteData({
      endpoint: `/projekte-api/projects/${encodeURIComponent(params.projectId)}${url.search}`,
      signal: request.signal,
      isPayload: isProjectDetailLoaderData,
    }),
  );
}

/** Sends a change of the project to the API, which runs the page's action. */
export async function clientAction({
  request,
}: Route.ClientActionArgs): Promise<unknown> {
  return sendToBackend(request);
}

/** Renders the project detail page with its five configuration tabs. */
export default function ProjectDetailRoute(): React.ReactElement {
  const { t } = useTranslation();
  const loaderData = useLocalStateRoute(
    useLoaderData<typeof clientLoader>(),
    PROJECT_DETAIL_STATE,
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const activeTab: DetailTab = (DETAIL_TABS as readonly string[]).includes(
    requestedTab ?? "",
  )
    ? (requestedTab as DetailTab)
    : loaderData.activeTab;

  function handleSelectTab(tab: DetailTab): void {
    setSearchParams(tab === "general" ? {} : { tab }, {
      preventScrollReset: true,
    });
  }

  function handleTabValueChange(nextTab: string): void {
    handleSelectTab(nextTab as DetailTab);
  }

  return (
    <section className="mx-auto flex h-[calc(100dvh-8.5rem)] min-h-0 min-w-0 max-w-[92rem] flex-col">
      <div className="min-w-0 shrink-0">
        <ProjectHeader
          project={loaderData.project}
          canWrite={loaderData.canWrite}
        />

        <HorizontalScrollArea
          className="mt-6"
          contentClassName="w-max pr-14 pb-2"
        >
          <Tabs
            value={activeTab}
            onValueChange={handleTabValueChange}
            ariaLabel={loaderData.project.name}
            tabs={DETAIL_TABS.map((tab) => ({
              value: tab,
              label: t(`projectDetail.tabs.${tab}`),
            }))}
          />
        </HorizontalScrollArea>
      </div>

      <VerticalScrollArea
        className="mt-6 min-h-0 flex-1 overflow-hidden"
        contentClassName="min-w-0 pr-4 pb-2"
      >
        <div role="tabpanel">
          {activeTab === "general" ? (
            <ProjectGeneralTab
              permissions={loaderData.permissions}
              departmentChoices={loaderData.departmentChoices}
              project={loaderData.project}
              members={loaderData.members}
              goals={loaderData.goals}
              tags={loaderData.tags}
              events={loaderData.events}
              milestones={loaderData.milestones}
              workItems={loaderData.workItems}
              canWrite={loaderData.canWrite}
            />
          ) : null}
          {activeTab === "team" ? (
            <ProjectTeamTab
              members={loaderData.members}
              eligibleUsers={loaderData.eligibleUsers}
              canWrite={loaderData.canWrite}
            />
          ) : null}
          {activeTab === "planning" ? (
            <ProjectPlanningTab
              milestones={loaderData.milestones}
              milestoneLinks={loaderData.milestoneLinks}
              canArchive={loaderData.canArchiveMilestones}
              canWrite={loaderData.canWrite}
            />
          ) : null}
          {activeTab === "integrations" ? (
            <ProjectIntegrationsTab
              key={loaderData.project.id}
              integration={loaderData.integration}
              isDiscordConnected={loaderData.discordConnected}
              canWrite={loaderData.canWrite}
              projectId={loaderData.project.id}
            />
          ) : null}
          {activeTab === "activity" ? (
            <ProjectActivityTab
              activity={loaderData.activity}
              taskHistory={loaderData.taskHistory}
            />
          ) : null}
        </div>
      </VerticalScrollArea>
    </section>
  );
}
