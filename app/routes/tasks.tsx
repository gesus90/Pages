import { useLoaderData } from "react-router";

import { TasksContent } from "@/app/components/tasks/board/tasks-content";
import { TasksToolbar } from "@/app/components/tasks/board/tasks-toolbar";
import { useTaskFilters } from "@/app/components/tasks/board/use-task-filters";
import { useTasksDialog } from "@/app/components/tasks/board/use-tasks-dialog";
import { useTasksPage } from "@/app/components/tasks/board/use-tasks-page";
import { TasksDetail } from "@/app/components/tasks/board/tasks-detail";
import { TasksFormDialog } from "@/app/components/tasks/board/tasks-form-dialog";
import { type TasksGitHubProjectState } from "@/app/components/tasks/tasks-github";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { cn } from "@/app/lib/cn";
import { getApplicationServices } from "@/app/lib/services.server";
import { filterWorkItems } from "@/app/lib/task-filters";
import { handleTaskAction } from "@/app/lib/task-actions/task-actions.server";
import { TASKS_VIEW_MODES } from "@/app/lib/tasks-view";
import { ProjectAccessDeniedError } from "@/backend/error/ProjectErrors";
import { WorkItemNotFoundError } from "@/backend/error/WorkItemErrors";

import type { ApplicationServices } from "@/app/lib/services.server";
import type { TaskActionResponse } from "@/app/lib/task-actions/task-action-support.server";
import type { ArchivedFilter, TasksViewMode } from "@/app/lib/tasks-view";
import type { GitHubPullRequest } from "@/definition/GitHub";
import type { Project } from "@/definition/Project";
import type {
  Milestone,
  ProjectLabel,
  WorkItemChecklistItem,
  WorkItemDetail,
  WorkItemHistory,
  WorkItemLink,
  WorkflowStatus,
} from "@/definition/Task";
import type { User } from "@/definition/User";
import type { Route } from "./+types/tasks";

export type { ArchivedFilter } from "@/app/lib/tasks-view";

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

/**
 * Reads the initial board view from the request URL.
 *
 * @param value - Raw query value kept by the ticket detail back link.
 * @returns The selected view, defaulting to the kanban board.
 */
export function parseViewMode(value: string | null): TasksViewMode {
  return TASKS_VIEW_MODES.find((mode) => mode === value) ?? "kanban";
}

interface TasksLoaderData {
  readonly actor: User;
  readonly projects: readonly Project[];
  readonly statuses: readonly WorkflowStatus[];
  readonly milestones: readonly Milestone[];
  readonly assignees: readonly User[];
  readonly assigneesByProject: Readonly<Record<string, readonly User[]>>;
  readonly workItems: readonly WorkItemDetail[];
  readonly labelsByWorkItem: Readonly<Record<string, readonly ProjectLabel[]>>;
  readonly labelsByProject: Readonly<Record<string, readonly ProjectLabel[]>>;
  readonly labelUsageByProject: Readonly<
    Record<string, Readonly<Record<string, number>>>
  >;
  readonly archivedFilter: ArchivedFilter;
  readonly selectedItem: WorkItemDetail | null;
  readonly selectedSubtasks: readonly WorkItemDetail[];
  readonly selectedHistory: readonly WorkItemHistory[];
  readonly selectedPullRequests: readonly GitHubPullRequest[];
  readonly selectedChecklist: readonly WorkItemChecklistItem[];
  readonly selectedLinks: readonly WorkItemLink[];
  readonly githubStates: readonly TasksGitHubProjectState[];
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

/** The labels of every project and how often each one is used. */
async function loadProjectLabels(
  services: ApplicationServices,
  projects: readonly Project[],
): Promise<Pick<TasksLoaderData, "labelsByProject" | "labelUsageByProject">> {
  const projectIds = projects.map((project) => project.id);
  const labels = await services.taskService.findLabelsByProjects(projectIds);
  const usage =
    await services.taskService.countLabelUsageByProjects(projectIds);
  const labelsByProject: Record<string, readonly ProjectLabel[]> = {};
  const labelUsageByProject: Record<
    string,
    Readonly<Record<string, number>>
  > = {};

  for (const project of projects) {
    labelsByProject[project.id] = labels.get(project.id) ?? [];
    labelUsageByProject[project.id] = Object.fromEntries(
      usage.get(project.id) ?? [],
    );
  }

  return { labelUsageByProject, labelsByProject };
}

type TaskSelection = Pick<
  TasksLoaderData,
  | "selectedItem"
  | "selectedSubtasks"
  | "selectedHistory"
  | "selectedPullRequests"
  | "selectedChecklist"
  | "selectedLinks"
>;

const NO_SELECTION: TaskSelection = {
  selectedChecklist: [],
  selectedHistory: [],
  selectedItem: null,
  selectedLinks: [],
  selectedPullRequests: [],
  selectedSubtasks: [],
};

/**
 * Loads the ticket the address selects together with everything its panel shows.
 *
 * @param services - Application services the panel data comes from.
 * @param request - Visitor, listed tickets and the selected key. The labels of
 * the listed tickets get the selected ticket's labels added when it lies
 * outside the list.
 */
async function loadSelection(
  services: ApplicationServices,
  request: {
    readonly actor: User;
    readonly workItems: readonly WorkItemDetail[];
    readonly labelsByWorkItem: Record<string, readonly ProjectLabel[]>;
    readonly selectedKey: string | null;
  },
): Promise<TaskSelection> {
  const { actor, workItems, labelsByWorkItem, selectedKey } = request;

  if (!selectedKey) {
    return NO_SELECTION;
  }

  const matched =
    workItems.find(
      (item) => item.key === selectedKey || item.id === selectedKey,
    ) ?? (await findSelectedWorkItem(services, actor, selectedKey));

  if (!matched) {
    return NO_SELECTION;
  }

  if (!Object.hasOwn(labelsByWorkItem, matched.id)) {
    const assigned = await services.taskService.findLabelsForWorkItems([
      matched.id,
    ]);

    labelsByWorkItem[matched.id] = assigned.get(matched.id) ?? [];
  }

  return {
    selectedChecklist: await services.taskService.findChecklistItems(
      actor,
      matched.id,
    ),
    selectedHistory: await services.taskService.getHistory(actor, matched.id),
    selectedItem: matched,
    selectedLinks: await services.taskService.findLinks(actor, matched.id),
    selectedPullRequests:
      await services.gitHubSyncService.findPullRequestsForTask(
        actor,
        matched.id,
      ),
    selectedSubtasks: await services.taskService.findSubtasks(
      actor,
      matched.id,
    ),
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
  const archivedFilter = parseArchivedFilter(url.searchParams.get("archived"));
  const projects = await services.projectService.findAll(actor);
  const projectIds = projects.map((project) => project.id);
  const workItems = await services.taskService.findAll(actor, {
    archived: archivedFilter,
  });
  const labelsByWorkItem: Record<string, readonly ProjectLabel[]> = {};

  if (workItems.length > 0) {
    const assigned = await services.taskService.findLabelsForWorkItems(
      workItems.map((item) => item.id),
    );

    for (const [workItemId, labels] of assigned) {
      labelsByWorkItem[workItemId] = labels;
    }
  }

  return {
    actor,
    archivedFilter,
    ...(await loadAssignees(services, projects)),
    githubStates:
      parseViewMode(url.searchParams.get("view")) === "github"
        ? await findGitHubStates(services, projects)
        : [],
    ...(await loadProjectLabels(services, projects)),
    labelsByWorkItem,
    milestones: await services.taskService.findMilestones(actor, projectIds),
    projects,
    ...(await loadSelection(services, {
      actor,
      labelsByWorkItem,
      selectedKey: url.searchParams.get("item"),
      workItems,
    })),
    statuses: await services.taskService.findAllStatuses(),
    workItems,
  };
}

/**
 * Resolves a selected ticket outside the current board filter from the database.
 *
 * @param services - Initialized server-side services.
 * @param actor - Authenticated user requesting the ticket.
 * @param selectedKey - Ticket key or id from the query string.
 * @returns The ticket, or `null` when it is missing or inaccessible.
 */
async function findSelectedWorkItem(
  services: ApplicationServices,
  actor: User,
  selectedKey: string,
): Promise<WorkItemDetail | null> {
  try {
    return await services.taskService.getByKey(actor, selectedKey);
  } catch (error: unknown) {
    // Missing or inaccessible tickets simply leave the detail panel closed.
    if (
      error instanceof WorkItemNotFoundError ||
      error instanceof ProjectAccessDeniedError
    ) {
      return null;
    }

    throw error;
  }
}

/**
 * Loads GitHub states for already access-checked projects with three queries.
 *
 * @param services - Initialized server-side services.
 * @param projects - Projects the actor may access.
 */
async function findGitHubStates(
  services: ApplicationServices,
  projects: readonly Project[],
): Promise<TasksGitHubProjectState[]> {
  const projectIds = projects.map((project) => project.id);
  const [integrations, externalIssuesByProject, pullRequestsByProject] =
    await Promise.all([
      services.projectService.findIntegrationsByProjects(projectIds),
      services.gitHubSyncService.findExternalIssuesByProjects(projectIds),
      services.gitHubSyncService.findPullRequestsByProjects(projectIds),
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

/** Renders the responsive task views, filters, and floating ticket detail panel. */
export default function TasksRoute(): React.ReactElement {
  const loaderData = useLoaderData<typeof loader>();
  const { selectedItem, projects, statuses, milestones, workItems } =
    loaderData;
  const page = useTasksPage(parseViewMode);
  const filterState = useTaskFilters();
  const dialog = useTasksDialog(
    selectedItem?.key ?? null,
    filterState.filters.project,
  );
  const viewMode = page.viewMode;

  return (
    <section
      className={cn(
        "flex flex-col",
        viewMode === "kanban"
          ? "h-[calc(100dvh-8.5rem)] min-h-0 overflow-hidden"
          : "min-h-[calc(100vh-theme(spacing.20))]",
      )}
    >
      <div
        className={cn(
          "flex flex-1 gap-6",
          viewMode === "kanban"
            ? "min-h-0 flex-col"
            : "flex-col xl:flex-row xl:items-start",
        )}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <TasksToolbar
            archivedFilter={loaderData.archivedFilter}
            milestones={milestones}
            onArchivedChange={page.changeArchived}
            onCreate={dialog.openCreate}
            onViewModeChange={page.changeView}
            projects={projects}
            state={filterState}
            statuses={statuses}
            viewMode={viewMode}
          />

          <div
            className={cn(
              "relative mt-5 flex min-h-0 flex-1 flex-col",
              viewMode === "kanban" && "overflow-hidden",
            )}
          >
            <TasksContent
              allItems={workItems}
              dialog={dialog}
              githubStates={loaderData.githubStates}
              isSyncing={page.isSyncing}
              labelsByWorkItem={loaderData.labelsByWorkItem}
              milestones={milestones}
              onMoveTask={page.moveTask}
              projectFilter={filterState.filters.project}
              statuses={statuses}
              viewMode={viewMode}
              visibleItems={filterWorkItems(
                workItems,
                filterState.filters,
                loaderData.actor.id,
              )}
            />
          </div>
        </div>
      </div>

      {selectedItem ? (
        <TasksDetail
          loaderData={loaderData}
          dialog={dialog}
          isArchiving={page.isArchiving}
          isSyncing={page.isSyncing}
          selectedItem={selectedItem}
        />
      ) : null}

      <TasksFormDialog
        loaderData={loaderData}
        dialog={dialog}
        isSubmitting={page.isSubmittingForm}
      />
    </section>
  );
}
