import { authenticatedUserContext } from "@/app/lib/auth.server";
import { readLocalStateAudience } from "@/app/lib/local-state/local-state-audience.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { sanitizeBoardReferences } from "@/app/lib/board-references";
import { handleTaskAction } from "@/app/lib/task-actions/task-actions.server";
import { parseBoardQuery } from "@/definition/BoardPreferences";
import { loadSelection } from "@/app/lib/task-selection.server";

import type { TasksGitHubProjectState } from "@/app/components/tasks/tasks-github";
import type { ApplicationServices } from "@/app/lib/services.server";
import type { TaskActionResponse } from "@/app/lib/task-actions/task-action-support.server";
import type { ArchivedFilter } from "@/app/lib/tasks-view";
import type { BoardReferences } from "@/app/lib/board-references";
import type { Project } from "@/definition/Project";
import type { Label } from "@/definition/Task";
import type { User } from "@/definition/User";
import type { TasksLoaderData } from "./tasks";
import type { Route } from "./+types/tasks-server";

/**
 * Reads the archived filter from the request URL.
 *
 * @param value - Raw query value.
 * @returns The selected filter, defaulting to active tickets.
 */
export function parseArchivedFilter(value: string | null): ArchivedFilter {
  if (value === "archived" || value === "all") {
    return value;
  }

  return "active";
}

/** The assignee lists a project's tickets can use. */
async function loadAssignees(
  services: ApplicationServices,
  projects: readonly Project[],
): Promise<Pick<TasksLoaderData, "assignees" | "assigneesByProject">> {
  const byProjects = await services.taskService.findAssigneesByProjects(
    projects.map((project) => project.id),
  );
  const unique = new Map<string, User>();
  const assigneesByProject: Record<string, readonly User[]> = {};

  for (const project of projects) {
    const projectAssignees = byProjects.get(project.id) ?? [];

    assigneesByProject[project.id] = projectAssignees;

    for (const assignee of projectAssignees) {
      unique.set(assignee.id, assignee);
    }
  }

  return {
    assignees: Array.from(unique.values()).sort((first, second) =>
      first.displayName.localeCompare(second.displayName),
    ),
    assigneesByProject,
  };
}

/** The global label catalog and how often each label is used on visible tickets. */
async function loadLabels(
  services: ApplicationServices,
  actor: User,
): Promise<Pick<TasksLoaderData, "labels" | "labelUsage">> {
  return {
    labelUsage: Object.fromEntries(
      await services.taskService.countLabelUsage(actor),
    ),
    labels: await services.taskService.findLabels(),
  };
}

/** The identifiers the board filters of the visitor may point to. */
function toBoardReferences(
  loaded: Pick<
    TasksLoaderData,
    | "projects"
    | "statuses"
    | "milestones"
    | "labels"
    | "departmentChoices"
    | "assignees"
    | "assigneeGroups"
  >,
): BoardReferences {
  const idsOf = (items: readonly { readonly id: string }[]): Set<string> =>
    new Set(items.map((item) => item.id));

  return {
    assigneeIds: idsOf(loaded.assignees),
    departmentIds: idsOf(loaded.departmentChoices.available),
    groupIds: idsOf(loaded.assigneeGroups),
    labelIds: idsOf(loaded.labels),
    milestoneIds: idsOf(loaded.milestones),
    projectIds: idsOf(loaded.projects),
    statusIds: idsOf(loaded.statuses),
  };
}

/** Loads all accessible work items, projects, statuses, and milestones for SSR. */
export async function loader({
  context,
  request,
}: Route.LoaderArgs): Promise<TasksLoaderData> {
  const actor = context.get(authenticatedUserContext);

  if (!actor) {
    throw new Error("Authenticated middleware did not provide a user.");
  }

  const services = await getApplicationServices();
  const url = new URL(request.url);
  const projects = await services.projectService.findAll(actor);
  const projectIds = projects.map((project) => project.id);
  // Archived tickets are for those who may archive; the service limits them
  // to the projects of that right again, so the address cannot widen it.
  const canFilterArchived = await services.taskService.canArchiveAny(
    actor,
    projectIds,
  );
  const archivedFilter = canFilterArchived
    ? parseArchivedFilter(url.searchParams.get("archived"))
    : "active";
  const workItems = await services.taskService.findAll(actor, {
    archived: archivedFilter,
  });
  const labelsByWorkItem: Record<string, readonly Label[]> = {};

  if (workItems.length > 0) {
    const assigned = await services.taskService.findLabelsForWorkItems(
      workItems.map((item) => item.id),
    );

    for (const [workItemId, labels] of assigned) {
      labelsByWorkItem[workItemId] = labels;
    }
  }

  const assignees = await loadAssignees(services, projects);
  const references = {
    ...assignees,
    ...(await loadLabels(services, actor)),
    assigneeGroupIdsByProject:
      await services.taskService.findAssigneeGroupIdsByProject(
        actor,
        assignees.assigneesByProject,
      ),
    assigneeGroups: await services.taskService.findAssigneeGroups(actor),
    departmentChoices: await services.taskService.departmentChoices(actor),
    milestones: await services.taskService.findMilestones(actor, projectIds),
    projects,
    statuses: await services.taskService.findAllStatuses(actor),
  };
  const board = sanitizeBoardReferences(
    parseBoardQuery(
      url.searchParams,
      await services.boardPreferencesService.find(actor.id),
    ),
    toBoardReferences(references),
  );

  return {
    actor,
    archivedFilter,
    audience: await readLocalStateAudience(services, actor),
    board,
    canFilterArchived,
    ...references,
    githubStates:
      board.view === "github"
        ? await findGitHubStates(services, projects, actor)
        : [],
    labelsByWorkItem,
    memberGroupIds: await services.taskService.findMemberGroupIds(actor),
    permissions: await services.taskService.actionPermissions(actor),
    ...(await loadSelection(services, {
      actor,
      labelsByWorkItem,
      selectedKey: url.searchParams.get("item"),
      workItems,
    })),
    templates: await services.taskTemplateService.findVisible(actor),
    workItems,
  };
}

/**
 * Loads GitHub states for already access-checked projects with three queries.
 *
 * @param services - Initialized server-side services.
 * @param projects - Projects the actor may access.
 * @param actor - Account whose ticket visibility restricts pull requests.
 */
async function findGitHubStates(
  services: ApplicationServices,
  projects: readonly Project[],
  actor: User,
): Promise<TasksGitHubProjectState[]> {
  const projectIds = projects.map((project) => project.id);
  const [integrations, externalIssuesByProject, pullRequestsByProject] =
    await Promise.all([
      services.projectService.findIntegrationsByProjects(projectIds),
      services.gitHubSyncService.findExternalIssuesByProjects(projectIds),
      services.gitHubSyncService.findPullRequestsByProjects(actor, projectIds),
    ]);

  return projects.map((project) => ({
    externalIssues: externalIssuesByProject.get(project.id) ?? [],
    integration: integrations.get(project.id) ?? null,
    project,
    pullRequests: pullRequestsByProject.get(project.id) ?? [],
  }));
}

/** Mutates tasks, column sort orders, and audit history. */
export async function action({
  context,
  request,
}: Route.ActionArgs): Promise<TaskActionResponse> {
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

  return handleTaskAction(formData.get("intent"), {
    actor,
    formData,
    services: await getApplicationServices(),
  });
}
