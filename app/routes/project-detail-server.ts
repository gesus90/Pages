import { authenticatedUserContext } from "@/app/lib/auth.server";
import { readLocalStateAudience } from "@/app/lib/local-state/local-state-audience.server";
import { toActionError } from "@/app/lib/project-actions/project-action-support.server";
import { handleProjectAction } from "@/app/lib/project-actions/project-actions.server";
import { handleProjectScopeAction } from "@/app/lib/project-actions/project-scope-actions.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  ProjectAccessDeniedError,
  ProjectNotFoundError,
} from "@/backend/error/ProjectErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import { DETAIL_TABS } from "./project-detail";

import type { ApplicationServices } from "@/app/lib/services.server";
import type { ProjectActionResponse } from "@/app/lib/project-actions/project-action-support.server";
import type { User } from "@/definition/User";
import type { DetailTab, ProjectDetailLoaderData } from "./project-detail";
import type { Route } from "./+types/project-detail-server";

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
      audience: await readLocalStateAudience(services, actor),
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
