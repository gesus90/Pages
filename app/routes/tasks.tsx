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
import { useLocalStateRoute } from "@/app/components/common/use-local-state-route";
import { type TasksGitHubProjectState } from "@/app/components/tasks/tasks-github";
import { cn } from "@/app/lib/cn";
import { sendToBackend } from "@/app/lib/backend-request";
import { isLiveRevalidation } from "@/app/lib/live-changes/live-revalidation";
import {
  isCurrentLocalStateAudience,
  isLocalStateAudience,
} from "@/app/lib/local-state/local-state-audience";
import {
  loadLocalFirst,
  localStateRoute,
} from "@/app/lib/local-state/local-state-loader";
import { readRouteData } from "@/app/lib/local-state/route-data";
import { filterWorkItems, toTaskFilters } from "@/app/lib/task-filters";
import {
  hasBoardQuery,
  withoutBoardQuery,
} from "@/definition/BoardPreferences";
import {
  BOARD_DETAIL_INTENTS,
  BOARD_TICKET_UPDATE_INTENTS,
} from "@/app/lib/task-overlay-navigation";

import type { ShouldRevalidateFunctionArgs } from "react-router";
import type { LocalStateRouteKind } from "@/app/components/common/use-local-state-route";
import type { TicketAccess } from "@/app/components/tasks/ticket-access";
import type { LocalStateAudience } from "@/app/lib/local-state/local-state-audience";
import type { WithLocalState } from "@/app/lib/local-state/local-state-loader";
import type { ArchivedFilter } from "@/app/lib/tasks-view";
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

/** The board as its endpoint answers it. */
export interface TasksLoaderData {
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
  readonly audience: LocalStateAudience;
}

function isTasksLoaderData(value: unknown): value is TasksLoaderData {
  return (
    typeof value === "object" &&
    value !== null &&
    "workItems" in value &&
    Array.isArray(value.workItems) &&
    "projects" in value &&
    Array.isArray(value.projects) &&
    "board" in value &&
    typeof value.board === "object" &&
    "permissions" in value &&
    typeof value.permissions === "object" &&
    "audience" in value &&
    isLocalStateAudience(value.audience)
  );
}

/** The board, kept per account, rights and address. */
const TASKS_PAGE_STATE: LocalStateRouteKind<TasksLoaderData> = {
  schemaVersion: 1,
  isPayload: isTasksLoaderData,
  isCurrent: (page) => isCurrentLocalStateAudience(page.audience),
  ownerOf: (page) => page.audience.userId,
  isRefused: () => false,
};

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
 * because it asks for the saved preferences. A live notice about a change on
 * another page always loads again.
 */
export function shouldRevalidate(args: ShouldRevalidateFunctionArgs): boolean {
  const { currentUrl, nextUrl, formData, defaultShouldRevalidate } = args;
  const actionResult: unknown = args.actionResult;
  if (isLiveRevalidation(args)) {
    return true;
  }

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

/**
 * Opens the board from the account's kept answer at once and asks the endpoint behind it.
 *
 * @remarks
 * The endpoint runs the server loader with its permission checks; the
 * address's query reaches it unchanged.
 */
export async function clientLoader({
  request,
}: Route.ClientLoaderArgs): Promise<WithLocalState<TasksLoaderData>> {
  const url = new URL(request.url);
  return loadLocalFirst(localStateRoute(url), TASKS_PAGE_STATE, () =>
    readRouteData({
      endpoint: `/aufgaben-api/board${url.search}`,
      signal: request.signal,
      isPayload: isTasksLoaderData,
    }),
  );
}

/** Sends a change of tickets to the API, which runs the board's action. */
export async function clientAction({
  request,
}: Route.ClientActionArgs): Promise<unknown> {
  return sendToBackend(request);
}

/** What the ticket views of the board may do and choose from. */
function ticketAccessOf(loaderData: TasksLoaderData): TicketAccess {
  return {
    ...loaderData.permissions,
    assigneeGroupIdsByProject: loaderData.assigneeGroupIdsByProject,
    assigneeGroups: loaderData.assigneeGroups,
    departments: loaderData.departmentChoices.available,
    knownDepartments: loaderData.departmentChoices.known,
    projects: loaderData.projects,
  };
}

/** Renders the responsive task views, filters, and floating ticket detail panel. */
export default function TasksRoute(): React.ReactElement {
  const loaderData = useLocalStateRoute(
    useLoaderData<typeof clientLoader>(),
    TASKS_PAGE_STATE,
  );
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
    <TicketAccessProvider value={ticketAccessOf(loaderData)}>
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
