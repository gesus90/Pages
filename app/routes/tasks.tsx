import { useLoaderData } from "react-router";

import { TasksContent } from "@/app/components/tasks/board/tasks-content";
import { TasksToolbar } from "@/app/components/tasks/board/tasks-toolbar";
import { useBoardPreferences } from "@/app/components/tasks/board/use-board-preferences";
import { useBoardItems } from "@/app/components/tasks/board/use-board-items";
import { useBoardLabels } from "@/app/components/tasks/board/use-board-labels";
import { useTasksDialog } from "@/app/components/tasks/board/use-tasks-dialog";
import { useTasksPage } from "@/app/components/tasks/board/use-tasks-page";
import { TasksDetailOverlay } from "@/app/components/tasks/board/tasks-detail-overlay";
import { useTaskSelection } from "@/app/components/tasks/board/use-task-selection";
import { TasksFormDialog } from "@/app/components/tasks/board/tasks-form-dialog";
import { TicketAccessProvider } from "@/app/components/tasks/ticket-access";
import { type TasksGitHubProjectState } from "@/app/components/tasks/tasks-github";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { cn } from "@/app/lib/cn";
import { getApplicationServices } from "@/app/lib/services.server";
import { sanitizeBoardReferences } from "@/app/lib/board-references";
import { filterWorkItems, toTaskFilters } from "@/app/lib/task-filters";
import { handleTaskAction } from "@/app/lib/task-actions/task-actions.server";
import {
  hasBoardQuery,
  parseBoardQuery,
  withoutBoardQuery,
} from "@/definition/BoardPreferences";
import { loadSelection } from "@/app/lib/task-selection.server";
import {
  BOARD_DETAIL_INTENTS,
  BOARD_TICKET_UPDATE_INTENTS,
} from "@/app/lib/task-overlay-navigation";

import type { ShouldRevalidateFunctionArgs } from "react-router";
import type { ApplicationServices } from "@/app/lib/services.server";
import type { TaskActionResponse } from "@/app/lib/task-actions/task-action-support.server";
import type { ArchivedFilter } from "@/app/lib/tasks-view";
import type { BoardReferences } from "@/app/lib/board-references";
import type { BoardPreferences } from "@/definition/BoardPreferences";
import type { GitHubPullRequest } from "@/definition/GitHub";
import type { Project } from "@/definition/Project";
import type {
  Milestone,
  Label,
  TaskActionPermissions,
  TicketDepartmentChoices,
  WorkItemAttachment,
  WorkItemChecklistItem,
  WorkItemDescendants,
  WorkItemDetail,
  WorkItemHistory,
  WorkItemLink,
  WorkflowStatus,
} from "@/definition/Task";
import type { WorkItemTemplateView } from "@/definition/WorkItemTemplate";
import type { GroupSummary } from "@/definition/UserGroup";
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

interface TasksLoaderData {
  readonly actor: User;
  readonly projects: readonly Project[];
  readonly statuses: readonly WorkflowStatus[];
  readonly milestones: readonly Milestone[];
  readonly assignees: readonly User[];
  readonly assigneeGroups: readonly GroupSummary[];
  readonly assigneeGroupIdsByProject: Readonly<
    Record<string, readonly string[]>
  >;
  readonly memberGroupIds: readonly string[];
  readonly assigneesByProject: Readonly<Record<string, readonly User[]>>;
  readonly workItems: readonly WorkItemDetail[];
  readonly labelsByWorkItem: Readonly<Record<string, readonly Label[]>>;
  readonly labels: readonly Label[];
  readonly labelUsage: Readonly<Record<string, number>>;
  readonly archivedFilter: ArchivedFilter;
  /**
   * Whether the visitor may archive in a project they can open and so may
   * filter for archived tickets. Without it the filter stays at `active`.
   */
  readonly canFilterArchived: boolean;
  /** The board view after the address and the saved preferences are merged. */
  readonly board: BoardPreferences;
  readonly selectedItem: WorkItemDetail | null;
  readonly selectedSubtasks: readonly WorkItemDetail[];
  readonly selectedHistory: readonly WorkItemHistory[];
  readonly selectedPullRequests: readonly GitHubPullRequest[];
  readonly selectedChecklist: readonly WorkItemChecklistItem[];
  readonly selectedLinks: readonly WorkItemLink[];
  readonly selectedAttachments: readonly WorkItemAttachment[];
  readonly selectedDescendants: WorkItemDescendants | null;
  readonly githubStates: readonly TasksGitHubProjectState[];
  readonly permissions: TaskActionPermissions;
  readonly departmentChoices: TicketDepartmentChoices;
  readonly templates: readonly WorkItemTemplateView[];
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

/** A successful single-ticket edit supplies the replacement for the board. */
function isLocalTicketUpdate(
  url: URL,
  formData: FormData | undefined,
  result: unknown,
): boolean {
  const intent = formData?.get("intent");
  if (
    !url.searchParams.has("item") ||
    typeof result !== "object" ||
    result === null ||
    !("ok" in result) ||
    result.ok !== true
  )
    return false;
  if (typeof intent === "string" && BOARD_DETAIL_INTENTS.has(intent))
    return true;
  return (
    typeof intent === "string" &&
    BOARD_TICKET_UPDATE_INTENTS.has(intent) &&
    formData?.get("boardLocal") === "true" &&
    "ticket" in result
  );
}

/** Removes only the overlay selection, leaving the other address fields. */
function withoutItem(url: URL): string {
  const params = new URLSearchParams(url.searchParams);
  params.delete("item");
  return `${url.pathname}?${params.toString()}`;
}

/**
 * Keeps the loader from rerunning when only the board view changed.
 *
 * @remarks
 * The loader sends every ticket and the board filters on the client, so a new
 * filter, sort order or grouping needs no new data; saving the preferences
 * changes no ticket either. An address without board parameters loads again,
 * because it asks for the saved preferences.
 */
export function shouldRevalidate({
  currentUrl,
  nextUrl,
  formData,
  defaultShouldRevalidate,
  actionResult,
}: ShouldRevalidateFunctionArgs): boolean {
  if (formData?.get("intent") === "save-board-preferences") {
    return false;
  }

  if (isLocalTicketUpdate(currentUrl, formData, actionResult)) {
    return false;
  }

  if (formData || !hasBoardQuery(nextUrl.searchParams)) {
    if (!formData && withoutItem(currentUrl) === withoutItem(nextUrl)) {
      return false;
    }
    return defaultShouldRevalidate;
  }

  const strip = (url: URL): string => {
    const params = withoutBoardQuery(url.searchParams);
    params.delete("item");

    return `${url.pathname}?${params.toString()}`;
  };

  return strip(currentUrl) === strip(nextUrl) ? false : defaultShouldRevalidate;
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

/** Renders the responsive task views, filters, and floating ticket detail panel. */
export default function TasksRoute(): React.ReactElement {
  const loaderData = useLoaderData<typeof loader>();
  const { projects, statuses, milestones, archivedFilter } = loaderData;
  const page = useTasksPage();
  const board = useBoardPreferences(loaderData.board);
  const details = useTaskSelection(loaderData);
  const workItems = useBoardItems(
    loaderData.workItems,
    details,
    archivedFilter,
  );
  const labelsByWorkItem = useBoardLabels(loaderData.labelsByWorkItem, details);
  const dialog = useTasksDialog(details.selectedKey, board.preferences.project);

  return (
    <TicketAccessProvider
      value={{
        ...loaderData.permissions,
        assigneeGroupIdsByProject: loaderData.assigneeGroupIdsByProject,
        assigneeGroups: loaderData.assigneeGroups,
        departments: loaderData.departmentChoices.available,
        projects,
      }}
    >
      <section
        className={cn(
          "flex flex-col",
          board.preferences.view === "kanban"
            ? "md:h-[calc(100dvh-8.5rem)] md:min-h-0 md:overflow-hidden"
            : "min-h-[calc(100vh-theme(spacing.20))]",
        )}
      >
        <div
          className={cn(
            "flex flex-1 gap-6",
            board.preferences.view === "kanban"
              ? "min-h-0 flex-col"
              : "flex-col xl:flex-row xl:items-start",
          )}
        >
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <TasksToolbar
              archivedFilter={loaderData.archivedFilter}
              assignees={loaderData.assignees}
              board={board}
              canFilterArchived={loaderData.canFilterArchived}
              labels={loaderData.labels}
              milestones={milestones}
              onArchivedChange={page.changeArchived}
              onCreate={dialog.openCreate}
              projects={projects}
              statuses={statuses}
              templates={loaderData.templates}
            />

            <div
              className={cn(
                "relative mt-5 flex min-h-0 flex-1 flex-col",
                // On phones the page scrolls and the board keeps a height of
                // its own, so cards stay whole instead of sharing what the
                // filters leave over.
                board.preferences.view === "kanban" &&
                  "h-[max(30rem,calc(100dvh-18rem))] flex-none md:h-auto md:flex-1 md:overflow-hidden",
              )}
            >
              <TasksContent
                allItems={workItems}
                dialog={dialog}
                githubStates={loaderData.githubStates}
                isSyncing={page.isSyncing}
                labelsByWorkItem={labelsByWorkItem}
                milestones={milestones}
                onMoveTask={page.moveTask}
                onPreferencesChange={board.update}
                preferences={board.preferences}
                statuses={statuses}
                visibleItems={filterWorkItems(
                  workItems,
                  toTaskFilters(board.preferences),
                  {
                    actorId: loaderData.actor.id,
                    labelsByWorkItem,
                    memberGroupIds: loaderData.memberGroupIds,
                  },
                )}
              />
            </div>
          </div>
        </div>

        <TasksDetailOverlay
          loaderData={loaderData}
          dialog={dialog}
          details={details}
          isArchiving={page.isArchiving}
          isSyncing={page.isSyncing}
        />

        <TasksFormDialog
          loaderData={loaderData}
          dialog={dialog}
          isSubmitting={page.isSubmittingForm}
        />
      </section>
    </TicketAccessProvider>
  );
}
