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
import { useLocalStateRoute } from "@/app/components/common/use-local-state-route";
import { PageContent } from "@/app/components/ui/card";
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
import { WORK_ITEM_CHILD_TYPE } from "@/definition/Task";

import type { LocalStateRouteKind } from "@/app/components/common/use-local-state-route";
import type { LocalStateAudience } from "@/app/lib/local-state/local-state-audience";
import type { WithLocalState } from "@/app/lib/local-state/local-state-loader";
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

/** The task view the visitor came from. */
export type DetailViewMode =
  "kanban" | "list" | "hierarchy" | "milestones" | "github";

/** The ticket page as its endpoint answers it. */
export interface TaskDetailLoaderData {
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
  readonly audience: LocalStateAudience;
}

function isTaskDetailLoaderData(value: unknown): value is TaskDetailLoaderData {
  return (
    typeof value === "object" &&
    value !== null &&
    "ticket" in value &&
    typeof value.ticket === "object" &&
    value.ticket !== null &&
    "project" in value &&
    typeof value.project === "object" &&
    "permissions" in value &&
    typeof value.permissions === "object" &&
    "audience" in value &&
    isLocalStateAudience(value.audience)
  );
}

/** The ticket page, kept per account, rights and address. */
const TASK_DETAIL_STATE: LocalStateRouteKind<TaskDetailLoaderData> = {
  schemaVersion: 1,
  isPayload: isTaskDetailLoaderData,
  isCurrent: (page) => isCurrentLocalStateAudience(page.audience),
  ownerOf: (page) => page.audience.userId,
  isRefused: () => false,
};

/**
 * Opens the ticket from the account's kept answer at once and asks the endpoint behind it.
 *
 * @remarks
 * The endpoint runs the server loader with its permission checks; a missing
 * or refused ticket shows the same error page as before.
 */
export async function clientLoader({
  params,
  request,
}: Route.ClientLoaderArgs): Promise<WithLocalState<TaskDetailLoaderData>> {
  const url = new URL(request.url);
  return loadLocalFirst(localStateRoute(url), TASK_DETAIL_STATE, () =>
    readRouteData({
      endpoint: `/aufgaben-api/tickets/${encodeURIComponent(params.ticketKey)}${url.search}`,
      signal: request.signal,
      isPayload: isTaskDetailLoaderData,
    }),
  );
}

/** Sends a change of the ticket to the API, which runs the board's action. */
export async function clientAction({
  request,
}: Route.ClientActionArgs): Promise<unknown> {
  return sendToBackend(request);
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
          descendants={loaderData.descendants}
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
  const loaderData = useLocalStateRoute(
    useLoaderData<typeof clientLoader>(),
    TASK_DETAIL_STATE,
  );

  return (
    <TicketAccessProvider
      value={{
        ...loaderData.permissions,
        assigneeGroupIdsByProject: loaderData.assigneeGroupIdsByProject,
        assigneeGroups: loaderData.assigneeGroups,
        departments: loaderData.departmentChoices.available,
        knownDepartments: loaderData.departmentChoices.known,
        projects: loaderData.projects,
      }}
    >
      <TaskDetailView loaderData={loaderData} />
    </TicketAccessProvider>
  );
}
