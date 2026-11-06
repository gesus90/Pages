import { authenticatedUserContext } from "@/app/lib/auth.server";
import { readLocalStateAudience } from "@/app/lib/local-state/local-state-audience.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { publishesNewTasks } from "@/definition/Project";
import { ProjectAccessDeniedError } from "@/backend/error/ProjectErrors";
import { WorkItemNotFoundError } from "@/backend/error/WorkItemErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import { action } from "./tasks-server";

import type { ApplicationServices } from "@/app/lib/services.server";
import type { WorkItemDetail } from "@/definition/Task";
import type { User } from "@/definition/User";
import type { DetailViewMode, TaskDetailLoaderData } from "./task-detail";
import type { Route } from "./+types/task-detail-server";

export { action };

const DETAIL_VIEWS: readonly DetailViewMode[] = [
  "kanban",
  "list",
  "hierarchy",
  "milestones",
  "github",
];

/** Reads the task view the visitor came from, falling back to the board. */
export function parseDetailView(value: string | null): DetailViewMode {
  return DETAIL_VIEWS.find((view) => view === value) ?? "kanban";
}

/** Loads the parent of a ticket; a parent the visitor may not open stays hidden. */
async function loadParent(
  services: ApplicationServices,
  actor: User,
  parentId: string | null,
): Promise<WorkItemDetail | null> {
  if (parentId === null) {
    return null;
  }

  try {
    return await services.taskService.getById(actor, parentId);
  } catch (error: unknown) {
    logCaughtError("task_detail", error);

    // A parent from an inaccessible project stays hidden instead of
    // failing the whole ticket view.
    if (
      error instanceof WorkItemNotFoundError ||
      error instanceof ProjectAccessDeniedError
    ) {
      return null;
    }

    throw error;
  }
}

/** Reads the ticket of the address; a missing or hidden ticket is a 404. */
async function readTicket(
  services: ApplicationServices,
  actor: User,
  ticketKey: string,
): Promise<WorkItemDetail> {
  try {
    return await services.taskService.getByKey(actor, ticketKey);
  } catch (error: unknown) {
    logCaughtError("task_detail", error);

    if (error instanceof WorkItemNotFoundError) {
      throw new Response("Not Found", { status: 404 });
    }

    throw error;
  }
}

/** Loads one ticket with every relation from the database for instant display. */
export async function loader({
  context,
  params,
  request,
}: Route.LoaderArgs): Promise<TaskDetailLoaderData> {
  const actor = context.get(authenticatedUserContext);

  if (!actor) {
    throw new Error("Authenticated middleware did not provide a user.");
  }

  const ticketKey = params.ticketKey;

  if (!ticketKey) {
    throw new Response("Not Found", { status: 404 });
  }

  const services = await getApplicationServices();
  const ticket = await readTicket(services, actor, ticketKey);

  const project = await services.projectService.getById(
    actor,
    ticket.projectId,
  );
  const projects = await services.projectService.findAll(actor);
  const statuses = await services.taskService.findAllStatuses(actor);
  const milestones = await services.taskService.findMilestones(actor, [
    ticket.projectId,
  ]);
  const projectWorkItems = await services.taskService.findAll(actor, {
    projectIds: [ticket.projectId],
  });
  const children = await services.taskService.findSubtasks(actor, ticket.id);
  const history = await services.taskService.getHistory(actor, ticket.id);
  const pullRequests = await services.gitHubSyncService.findPullRequestsForTask(
    actor,
    ticket.id,
  );
  const assignees = await services.taskService.findEligibleAssignees(
    actor,
    ticket.projectId,
  );

  const parent = await loadParent(services, actor, ticket.parentId);

  const assigneesByProject: Record<string, readonly User[]> = {};

  for (const candidate of projects) {
    assigneesByProject[candidate.id] =
      await services.taskService.findEligibleAssignees(actor, candidate.id);
  }

  const labels = await services.taskService.findLabels();
  const taskLabels =
    (await services.taskService.findLabelsForWorkItems([ticket.id])).get(
      ticket.id,
    ) ?? [];
  const labelUsage = Object.fromEntries(
    await services.taskService.countLabelUsage(actor),
  );
  const url = new URL(request.url);

  return {
    actor,
    audience: await readLocalStateAudience(services, actor),
    assigneeGroupIdsByProject:
      await services.taskService.findAssigneeGroupIdsByProject(
        actor,
        assigneesByProject,
      ),
    assigneeGroups: await services.taskService.findAssigneeGroups(actor),
    assignees,
    assigneesByProject,
    attachments: await services.taskAttachmentService.list(actor, ticket.id),
    checklist: await services.taskService.findChecklistItems(actor, ticket.id),
    children,
    departmentChoices: await services.taskService.departmentChoices(actor),
    fromView: parseDetailView(url.searchParams.get("from")),
    history,
    labelUsage,
    descendants: await services.taskService.describeDescendants(
      actor,
      ticket.id,
    ),
    labels,
    links: await services.taskService.findLinks(actor, ticket.id),
    milestones,
    parent,
    permissions: await services.taskService.actionPermissions(actor),
    project,
    publishesNewTasks: publishesNewTasks(
      await services.projectService.findIntegration(actor, ticket.projectId),
    ),
    projectWorkItems,
    projects,
    pullRequests,
    statuses,
    taskLabels,
    templates: await services.taskTemplateService.findVisible(actor),
    ticket,
  };
}
