import { useLoaderData, useNavigate, useNavigation } from "react-router";

import { useTaskPanelActions } from "@/app/components/tasks/detail/use-task-panel-actions";
import { GitHubSyncBadge } from "@/app/components/tasks/github-sync-badge";
import { TicketDialogs } from "@/app/components/tasks/ticket/ticket-dialogs";
import { TicketBreadcrumb } from "@/app/components/tasks/ticket/ticket-breadcrumb";
import { TicketSidebar } from "@/app/components/tasks/ticket/ticket-sidebar";
import { TicketTabs } from "@/app/components/tasks/ticket/ticket-tabs";
import { TicketTop } from "@/app/components/tasks/ticket/ticket-top";
import { useTicketDialogs } from "@/app/components/tasks/ticket/use-ticket-dialogs";
import { TicketAccessProvider } from "@/app/components/tasks/ticket-access";
import { PageContent } from "@/app/components/ui/card";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { WORK_ITEM_TYPE } from "@/definition/Task";

import { action } from "./tasks";
import { ProjectAccessDeniedError } from "@/backend/error/ProjectErrors";
import { WorkItemNotFoundError } from "@/backend/error/WorkItemErrors";

import type { GitHubPullRequest } from "@/definition/GitHub";
import type { Project } from "@/definition/Project";
import type {
  Milestone,
  Label,
  TaskActionPermissions,
  TicketDepartmentChoices,
  WorkItemDetail,
  WorkItemHistory,
  WorkflowStatus,
} from "@/definition/Task";
import type { WorkItemTemplateView } from "@/definition/WorkItemTemplate";
import type { GroupSummary } from "@/definition/UserGroup";
import type { User } from "@/definition/User";
import type { Route } from "./+types/task-detail";

export { action };

const DETAIL_VIEWS = [
  "kanban",
  "list",
  "hierarchy",
  "milestones",
  "github",
] as const;

type DetailViewMode = (typeof DETAIL_VIEWS)[number];

/** Reads the task view the visitor came from, falling back to the board. */
export function parseDetailView(value: string | null): DetailViewMode {
  return DETAIL_VIEWS.find((view) => view === value) ?? "kanban";
}

interface TaskDetailLoaderData {
  readonly actor: User;
  readonly ticket: WorkItemDetail;
  readonly project: Project;
  readonly parent: WorkItemDetail | null;
  readonly children: readonly WorkItemDetail[];
  readonly history: readonly WorkItemHistory[];
  readonly pullRequests: readonly GitHubPullRequest[];
  readonly projects: readonly Project[];
  readonly projectWorkItems: readonly WorkItemDetail[];
  readonly statuses: readonly WorkflowStatus[];
  readonly milestones: readonly Milestone[];
  readonly assignees: readonly User[];
  readonly assigneeGroups: readonly GroupSummary[];
  readonly assigneesByProject: Readonly<Record<string, readonly User[]>>;
  readonly labels: readonly Label[];
  readonly taskLabels: readonly Label[];
  readonly labelUsage: Readonly<Record<string, number>>;
  readonly fromView: DetailViewMode;
  readonly permissions: TaskActionPermissions;
  readonly departmentChoices: TicketDepartmentChoices;
  readonly templates: readonly WorkItemTemplateView[];
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
  let ticket: WorkItemDetail;

  try {
    ticket = await services.taskService.getByKey(actor, ticketKey);
  } catch (error: unknown) {
    if (error instanceof WorkItemNotFoundError) {
      throw new Response("Not Found", { status: 404 });
    }

    throw error;
  }

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

  let parent: WorkItemDetail | null = null;

  if (ticket.parentId !== null) {
    try {
      parent = await services.taskService.getById(actor, ticket.parentId);
    } catch (error: unknown) {
      // A parent from an inaccessible project stays hidden instead of
      // failing the whole ticket view.
      if (
        error instanceof WorkItemNotFoundError ||
        error instanceof ProjectAccessDeniedError
      ) {
        parent = null;
      } else {
        throw error;
      }
    }
  }

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
    assigneeGroups: await services.taskService.findAssigneeGroups(actor),
    assignees,
    assigneesByProject,
    children,
    departmentChoices: await services.taskService.departmentChoices(actor),
    fromView: parseDetailView(url.searchParams.get("from")),
    history,
    labelUsage,
    labels,
    milestones,
    parent,
    permissions: await services.taskService.actionPermissions(actor),
    project,
    projectWorkItems,
    projects,
    pullRequests,
    statuses,
    taskLabels,
    templates: await services.taskTemplateService.findVisible(actor),
    ticket,
  };
}

/** Lists the active tickets of one type a ticket can be attached to. */
function parentCandidates(
  workItems: readonly WorkItemDetail[],
  ticket: WorkItemDetail,
  type: WorkItemDetail["type"],
): WorkItemDetail[] {
  return workItems.filter(
    (item) =>
      item.type === type && item.id !== ticket.id && item.archivedAt === null,
  );
}

/** Tells whether a form with one of the intents is being submitted. */
function isSubmittingIntent(
  navigation: ReturnType<typeof useNavigation>,
  ...intents: readonly string[]
): boolean {
  const intent = navigation.formData?.get("intent");

  return (
    navigation.state === "submitting" &&
    typeof intent === "string" &&
    intents.includes(intent)
  );
}

interface TaskDetailViewProps {
  readonly loaderData: TaskDetailLoaderData;
}

/** Renders the full ticket view inside the regular tasks content area. */
function TaskDetailView({
  loaderData,
}: TaskDetailViewProps): React.ReactElement {
  const { ticket, project, statuses, assignees, milestones } = loaderData;
  const navigate = useNavigate();
  const navigation = useNavigation();
  const actions = useTaskPanelActions(ticket);
  const dialogs = useTicketDialogs(ticket, loaderData.fromView);
  const isArchived = ticket.archivedAt !== null;
  const isArchiving = isSubmittingIntent(
    navigation,
    "archive-task",
    "restore-task",
  );
  const isSyncing = isSubmittingIntent(navigation, "sync-github-task");
  const backTarget = `/aufgaben?view=${loaderData.fromView}`;

  function handleOpenTicket(key: string): void {
    void navigate(`/aufgaben/${key}?from=${loaderData.fromView}`);
  }

  return (
    <PageContent>
      <div className="mx-auto flex w-full max-w-6xl flex-col">
        <TicketBreadcrumb
          backTarget={backTarget}
          project={project}
          ticket={ticket}
        />
        <TicketTop
          actions={actions}
          assignees={assignees}
          isArchived={isArchived}
          isArchiving={isArchiving}
          onBack={() => void navigate(backTarget)}
          onEdit={dialogs.openEdit}
          statuses={statuses}
          ticket={ticket}
        />

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <TicketTabs
            history={loaderData.history}
            isArchived={isArchived}
            items={loaderData.children}
            onCreateChild={dialogs.openCreateChild}
            onOpenChild={handleOpenTicket}
            ticket={ticket}
          />
          <TicketSidebar
            actions={actions}
            assignees={assignees}
            epicOptions={parentCandidates(
              loaderData.projectWorkItems,
              ticket,
              WORK_ITEM_TYPE.EPIC,
            )}
            initiativeOptions={parentCandidates(
              loaderData.projectWorkItems,
              ticket,
              WORK_ITEM_TYPE.INITIATIVE,
            )}
            isArchived={isArchived}
            isArchiving={isArchiving}
            isSyncing={isSyncing}
            milestones={milestones}
            redirectTo={backTarget}
            onEditLabels={() => dialogs.setIsLabelPickerOpen(true)}
            onMoveProject={() => dialogs.setIsMoveDialogOpen(true)}
            onOpenTicket={handleOpenTicket}
            parent={loaderData.parent}
            project={project}
            pullRequests={loaderData.pullRequests}
            statuses={statuses}
            taskLabels={loaderData.taskLabels}
            ticket={ticket}
          />
        </div>

        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <GitHubSyncBadge
            githubConflict={ticket.githubConflict}
            githubIssueNumber={ticket.githubIssueNumber}
            githubLastError={ticket.githubLastError}
            githubLastSyncAt={ticket.githubLastSyncAt}
            isSyncing={isSyncing}
            updatedAt={ticket.updatedAt}
          />
        </div>

        <TicketDialogs
          loaderData={loaderData}
          dialogs={dialogs}
          isSubmittingForm={isSubmittingIntent(
            navigation,
            "create-task",
            "update-task",
          )}
          isSyncing={isSyncing}
        />
      </div>
    </PageContent>
  );
}

/** Provides the access hints of the loader to the ticket view. */
export default function TaskDetailRoute(): React.ReactElement {
  const loaderData = useLoaderData<typeof loader>();

  return (
    <TicketAccessProvider
      value={{
        ...loaderData.permissions,
        assigneeGroups: loaderData.assigneeGroups,
        departments: loaderData.departmentChoices.available,
        projects: loaderData.projects,
      }}
    >
      <TaskDetailView loaderData={loaderData} />
    </TicketAccessProvider>
  );
}
