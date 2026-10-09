import { useLoaderData, useNavigate, useNavigation } from "react-router";

import { getAncestorChain } from "@/app/components/tasks/detail/detail-path-section";
import { useTaskPanelActions } from "@/app/components/tasks/detail/use-task-panel-actions";
import { GitHubSyncBadge } from "@/app/components/tasks/github-sync-badge";
import { TicketDialogs } from "@/app/components/tasks/ticket/ticket-dialogs";
import { TicketBreadcrumb } from "@/app/components/tasks/ticket/ticket-breadcrumb";
import { TicketMainColumn } from "@/app/components/tasks/ticket/ticket-main-column";
import { TicketSidebar } from "@/app/components/tasks/ticket/ticket-sidebar";
import { TicketTop } from "@/app/components/tasks/ticket/ticket-top";
import { useTicketDialogs } from "@/app/components/tasks/ticket/use-ticket-dialogs";
import { TicketAccessProvider } from "@/app/components/tasks/ticket-access";
import { PageContent } from "@/app/components/ui/card";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { publishesNewTasks } from "@/definition/Project";
import { WORK_ITEM_CHILD_TYPE } from "@/definition/Task";

import { action } from "./tasks";
import { ProjectAccessDeniedError } from "@/backend/error/ProjectErrors";
import { WorkItemNotFoundError } from "@/backend/error/WorkItemErrors";

import type { ApplicationServices } from "@/app/lib/services.server";
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
  readonly attachments: readonly WorkItemAttachment[];
  readonly checklist: readonly WorkItemChecklistItem[];
  readonly links: readonly WorkItemLink[];
  /** The descendants archiving or deleting the ticket reaches. */
  readonly descendants: WorkItemDescendants;
  readonly pullRequests: readonly GitHubPullRequest[];
  readonly projects: readonly Project[];
  readonly projectWorkItems: readonly WorkItemDetail[];
  readonly statuses: readonly WorkflowStatus[];
  readonly milestones: readonly Milestone[];
  readonly assignees: readonly User[];
  readonly assigneeGroups: readonly GroupSummary[];
  readonly assigneeGroupIdsByProject: Readonly<
    Record<string, readonly string[]>
  >;
  readonly assigneesByProject: Readonly<Record<string, readonly User[]>>;
  readonly labels: readonly Label[];
  readonly taskLabels: readonly Label[];
  readonly labelUsage: Readonly<Record<string, number>>;
  readonly fromView: DetailViewMode;
  readonly permissions: TaskActionPermissions;
  /** Whether new tasks of the ticket's project reach GitHub without further action. */
  readonly publishesNewTasks: boolean;
  readonly departmentChoices: TicketDepartmentChoices;
  readonly templates: readonly WorkItemTemplateView[];
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

/**
 * Renders the ticket as in Jira (A8.2-E07): path and actions on top, the
 * large description with the content of the ticket on the left, status and
 * the detail areas on the right; stacked on small screens.
 */
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
  const hrefOf = (key: string): string =>
    `/aufgaben/${key}?from=${loaderData.fromView}`;

  function handleOpenTicket(key: string): void {
    void navigate(hrefOf(key));
  }

  return (
    <PageContent>
      <div className="mx-auto flex w-full max-w-7xl flex-col">
        <TicketBreadcrumb
          ancestors={getAncestorChain(ticket, [
            ...loaderData.projectWorkItems,
            // An archived parent is not among the active tickets.
            ...(loaderData.parent ? [loaderData.parent] : []),
          ])}
          backTarget={backTarget}
          hrefOf={hrefOf}
          project={project}
          ticket={ticket}
        />
        <TicketTop
          actions={actions}
          canWrite={loaderData.permissions.canWrite}
          isArchived={isArchived}
          isArchiving={isArchiving}
          onBack={() => void navigate(backTarget)}
          onCreateChild={
            WORK_ITEM_CHILD_TYPE[ticket.type] === null
              ? null
              : dialogs.openCreateChild
          }
          onEdit={dialogs.openEdit}
          ticket={ticket}
        />

        <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
          <TicketMainColumn
            attachments={loaderData.attachments}
            canWrite={loaderData.permissions.canWrite}
            checklist={loaderData.checklist}
            children={loaderData.children}
            history={loaderData.history}
            hrefOf={hrefOf}
            isSubmitting={isSyncing}
            links={loaderData.links}
            onCreateChild={dialogs.openCreateChild}
            onOpenTicket={handleOpenTicket}
            projectWorkItems={loaderData.projectWorkItems}
            ticket={ticket}
          />
          <TicketSidebar
            actions={actions}
            assignees={assignees}
            descendants={loaderData.descendants}
            isArchived={isArchived}
            isArchiving={isArchiving}
            isSyncing={isSyncing}
            milestones={milestones}
            onEditLabels={() => dialogs.setIsLabelPickerOpen(true)}
            onMoveProject={() => dialogs.setIsMoveDialogOpen(true)}
            onOpenTicket={handleOpenTicket}
            project={project}
            projectWorkItems={loaderData.projectWorkItems}
            publishesNewTasks={loaderData.publishesNewTasks}
            pullRequests={loaderData.pullRequests}
            redirectTo={backTarget}
            statuses={statuses}
            taskLabels={loaderData.taskLabels}
            ticket={ticket}
          />
        </div>

        <TicketFooter
          dialogs={dialogs}
          isSubmittingForm={isSubmittingIntent(
            navigation,
            "create-task",
            "update-task",
          )}
          isSyncing={isSyncing}
          loaderData={loaderData}
        />
      </div>
    </PageContent>
  );
}

interface TicketFooterProps {
  readonly loaderData: TaskDetailLoaderData;
  readonly dialogs: ReturnType<typeof useTicketDialogs>;
  readonly isSyncing: boolean;
  readonly isSubmittingForm: boolean;
}

/** The GitHub state below the ticket and the dialogs of the ticket page. */
function TicketFooter({
  loaderData,
  dialogs,
  isSyncing,
  isSubmittingForm,
}: TicketFooterProps): React.ReactElement {
  const { ticket } = loaderData;

  return (
    <>
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
        isSubmittingForm={isSubmittingForm}
        isSyncing={isSyncing}
      />
    </>
  );
}

/** Provides the access hints of the loader to the ticket view. */
export default function TaskDetailRoute(): React.ReactElement {
  const loaderData = useLoaderData<typeof loader>();

  return (
    <TicketAccessProvider
      value={{
        ...loaderData.permissions,
        assigneeGroupIdsByProject: loaderData.assigneeGroupIdsByProject,
        assigneeGroups: loaderData.assigneeGroups,
        departments: loaderData.departmentChoices.available,
        projects: loaderData.projects,
      }}
    >
      <TaskDetailView loaderData={loaderData} />
    </TicketAccessProvider>
  );
}
