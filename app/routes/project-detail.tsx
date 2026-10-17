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
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { toActionError } from "@/app/lib/project-actions/project-action-support.server";
import { handleProjectAction } from "@/app/lib/project-actions/project-actions.server";
import { handleProjectScopeAction } from "@/app/lib/project-actions/project-scope-actions.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  ProjectAccessDeniedError,
  ProjectNotFoundError,
} from "@/backend/error/ProjectErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { ApplicationServices } from "@/app/lib/services.server";
import type { ProjectActionResponse } from "@/app/lib/project-actions/project-action-support.server";
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

const DETAIL_TABS = [
  "general",
  "team",
  "planning",
  "integrations",
  "activity",
] as const;

type DetailTab = (typeof DETAIL_TABS)[number];

interface ProjectDetailLoaderData {
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
}

function getProjectId(params: Route.LoaderArgs["params"]): string {
  const projectId = params.projectId;

  if (!projectId) {
    throw new Response("Not Found", { status: 404 });
  }

  return projectId;
}

function getActiveTab(request: Request): DetailTab {
  const tab = new URL(request.url).searchParams.get("tab");

  return (DETAIL_TABS as readonly string[]).includes(tab ?? "")
    ? (tab as DetailTab)
    : "general";
}

type TabData = Pick<
  ProjectDetailLoaderData,
  | "activity"
  | "canArchiveMilestones"
  | "canWrite"
  | "discordConnected"
  | "events"
  | "goals"
  | "integration"
  | "members"
  | "milestoneLinks"
  | "milestones"
  | "tags"
  | "taskHistory"
  | "workItems"
>;

/**
 * Tells whether the visitor may archive the milestones of the project.
 *
 * @param services - Application services of the request.
 * @param actor - The signed-in user.
 * @param projectId - Project being viewed.
 * @param isNeeded - Whether the selected tab shows the control; it is the
 * planning tab only, so no other tab asks.
 * @returns A hint for the control; archiving checks the right again.
 */
async function findArchiveHint(
  services: ApplicationServices,
  actor: User,
  projectId: string,
  isNeeded: boolean,
): Promise<boolean> {
  return isNeeded ? services.taskService.canArchive(actor, projectId) : false;
}

/**
 * Loads what the interfaces tab shows: the GitHub settings and whether Discord is connected.
 *
 * @param services - Application services of the request.
 * @param actor - The signed-in user.
 * @param projectId - Project being viewed.
 * @param isNeeded - Whether the interfaces tab is selected; no other tab asks.
 * @returns The settings and the status; empty when the tab is not selected.
 */
async function findIntegrations(
  services: ApplicationServices,
  actor: User,
  projectId: string,
  isNeeded: boolean,
): Promise<Pick<TabData, "discordConnected" | "integration">> {
  if (!isNeeded) {
    return { discordConnected: false, integration: null };
  }

  const [integration, discordConnected] = await Promise.all([
    services.projectService.findIntegration(actor, projectId),
    services.discordConnectionService.isConnected(actor, projectId),
  ]);

  return { discordConnected, integration };
}

/**
 * Loads only the data the selected tab shows, so switching tabs stays cheap.
 *
 * @param services - Application services of the request.
 * @param actor - The signed-in user.
 * @param projectId - Project being viewed.
 * @param activeTab - The selected tab.
 * @returns The data of that tab; everything else stays empty.
 */
async function loadTabData(
  services: ApplicationServices,
  actor: User,
  projectId: string,
  activeTab: DetailTab,
): Promise<TabData> {
  const needsGeneral = activeTab === "general";
  const needsTeam = activeTab === "team";
  const needsPlanning = activeTab === "planning";
  const needsIntegrations = activeTab === "integrations";
  const needsActivity = activeTab === "activity";

  const [
    members,
    goals,
    tags,
    events,
    integrations,
    activity,
    milestones,
    milestoneLinks,
    workItems,
    taskHistory,
    canWrite,
    canArchiveMilestones,
  ] = await Promise.all([
    needsGeneral || needsTeam
      ? services.projectService.findMembers(actor, projectId)
      : Promise.resolve([]),
    needsGeneral
      ? services.projectService.findGoals(actor, projectId)
      : Promise.resolve([]),
    needsGeneral
      ? services.projectService.findTags(actor, projectId)
      : Promise.resolve([]),
    needsGeneral || needsPlanning
      ? services.projectService.findEvents(actor, projectId)
      : Promise.resolve([]),
    findIntegrations(services, actor, projectId, needsIntegrations),
    needsActivity
      ? services.projectService.findActivity(actor, projectId)
      : Promise.resolve([]),
    needsGeneral || needsPlanning
      ? services.taskService.findMilestones(actor, [projectId])
      : Promise.resolve([]),
    needsPlanning
      ? services.taskService.findDependencies(actor, [projectId])
      : Promise.resolve([]),
    needsGeneral || needsPlanning
      ? services.taskService.findAll(actor, { projectIds: [projectId] })
      : Promise.resolve([]),
    needsActivity
      ? services.taskService.findHistoryByProject(actor, projectId)
      : Promise.resolve([]),
    services.projectService.canWriteProject(actor, projectId),
    findArchiveHint(services, actor, projectId, needsPlanning),
  ]);

  return {
    activity,
    canArchiveMilestones,
    canWrite,
    discordConnected: integrations.discordConnected,
    events,
    goals,
    integration: integrations.integration,
    members,
    milestoneLinks,
    milestones,
    tags,
    taskHistory,
    workItems,
  };
}

/** Looks up who may be added to the team; a failed lookup offers nobody. */
async function findAssignableUsers(
  services: ApplicationServices,
  actor: User,
  projectId: string,
): Promise<User[]> {
  try {
    return await services.taskService.findEligibleAssignees(actor, projectId);
  } catch (caughtError: unknown) {
    logCaughtError("project_detail", caughtError);

    return [];
  }
}

/** Loads the full project detail aggregate for server-side rendering. */
export async function loader({
  context,
  params,
  request,
}: Route.LoaderArgs): Promise<ProjectDetailLoaderData> {
  const actor = context.get(authenticatedUserContext);

  if (!actor) {
    throw new Error("Authenticated middleware did not provide a user.");
  }

  const projectId = getProjectId(params);

  try {
    const services = await getApplicationServices();
    const project = await services.projectService.getById(actor, projectId);
    const permissions = await services.projectService.permissions(
      actor,
      projectId,
    );
    const departmentChoices = permissions.canChangeDepartments
      ? await services.projectService.departmentChoices(actor)
      : { available: [], selectionRequired: false };
    const activeTab = getActiveTab(request);
    const tabData = await loadTabData(services, actor, projectId, activeTab);
    const eligibleUsers =
      activeTab === "team"
        ? await findAssignableUsers(services, actor, projectId)
        : [];

    return {
      ...tabData,
      activeTab,
      eligibleUsers,
      project,
      permissions,
      departmentChoices,
      statuses: [],
    };
  } catch (error: unknown) {
    logCaughtError("project_detail", error);

    if (error instanceof ProjectNotFoundError) {
      throw new Response("Not Found", { status: 404 });
    }

    if (error instanceof ProjectAccessDeniedError) {
      throw new Response("Forbidden", { status: 403 });
    }

    throw error;
  }
}

/** Applies project detail mutations through the persistent service layer. */
export async function action({
  context,
  params,
  request,
}: Route.ActionArgs): Promise<ProjectActionResponse | Response> {
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

  const projectId = getProjectId(params);
  const formData = await request.formData();

  try {
    const actionContext = {
      actor,
      formData,
      projectId,
      services: await getApplicationServices(),
    };
    const intent = formData.get("intent");
    const scopeResult = await handleProjectScopeAction(intent, actionContext);
    return scopeResult ?? (await handleProjectAction(intent, actionContext));
  } catch (error: unknown) {
    logCaughtError("project_detail", error);

    return toActionError(error);
  }
}

/** Renders the project detail page with its five configuration tabs. */
export default function ProjectDetailRoute(): React.ReactElement {
  const { t } = useTranslation();
  const loaderData = useLoaderData<typeof loader>();
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
