import { ArrowLeft, Calendar, Edit3, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigate,
  useNavigation,
  useSubmit,
} from "react-router";

import { Button } from "@/app/components/ui/button";
import { PageContent } from "@/app/components/ui/card";
import { Select } from "@/app/components/ui/select";
import { Tabs } from "@/app/components/ui/tabs";
import {
  TaskStatusBadge,
  TaskTypeBadge,
} from "@/app/components/tasks/task-badges";
import { GitHubSyncBadge } from "@/app/components/tasks/github-sync-badge";
import { LabelPicker } from "@/app/components/tasks/label-picker";
import { TaskActivityList } from "@/app/components/tasks/task-activity-list";
import { TaskFormDialog } from "@/app/components/tasks/task-form-dialog";
import { TaskGitHubDetails } from "@/app/components/tasks/task-github-details";
import { TaskLabelPill } from "@/app/components/tasks/task-labels";
import { TaskMoveDialog } from "@/app/components/tasks/task-move-dialog";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { ProjectAccessDeniedError } from "@/backend/service/ProjectService";
import { WorkItemNotFoundError } from "@/backend/service/TaskService";
import { WORK_ITEM_PRIORITY, WORK_ITEM_TYPE } from "@/definition/Task";

import { action } from "./tasks";

import type { ChangeEvent } from "react";
import type { GitHubPullRequest } from "@/definition/GitHub";
import type { Project } from "@/definition/Project";
import type {
  Milestone,
  ProjectLabel,
  WorkItemDetail,
  WorkItemHistory,
  WorkItemPriority,
  WorkItemType,
  WorkflowStatus,
} from "@/definition/Task";
import type { User } from "@/definition/User";
import type { LoaderFunctionArgs } from "react-router";

export { action };

type DetailViewMode = "kanban" | "list" | "hierarchy" | "milestones" | "github";

export function parseDetailView(value: string | null): DetailViewMode {
  switch (value) {
    case "kanban":
    case "list":
    case "hierarchy":
    case "milestones":
    case "github":
      return value;
    default:
      return "kanban";
  }
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
  readonly assigneesByProject: Readonly<Record<string, readonly User[]>>;
  readonly projectLabels: readonly ProjectLabel[];
  readonly taskLabels: readonly ProjectLabel[];
  readonly labelUsage: Readonly<Record<string, number>>;
  readonly fromView: DetailViewMode;
}

/** Loads one ticket with every relation from SQLite for instant display. */
export async function loader({
  context,
  params,
  request,
}: LoaderFunctionArgs): Promise<TaskDetailLoaderData> {
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
  const statuses = await services.taskService.findAllStatuses();
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

  const projectLabels = await services.taskService.findLabels(
    actor,
    ticket.projectId,
  );
  const taskLabels =
    (await services.taskService.findLabelsForWorkItems([ticket.id])).get(
      ticket.id,
    ) ?? [];
  const labelUsage = Object.fromEntries(
    await services.taskService.countLabelUsage(actor, ticket.projectId),
  );
  const url = new URL(request.url);

  return {
    actor,
    assignees,
    assigneesByProject,
    children,
    fromView: parseDetailView(url.searchParams.get("from")),
    history,
    labelUsage,
    milestones,
    parent,
    project,
    projectLabels,
    projectWorkItems,
    projects,
    pullRequests,
    statuses,
    taskLabels,
    ticket,
  };
}

/** Renders the full ticket view inside the regular tasks content area. */
export default function TaskDetailRoute(): React.ReactElement {
  const { t } = useTranslation();
  const {
    ticket,
    project,
    parent,
    children,
    history,
    pullRequests,
    projects,
    projectWorkItems,
    statuses,
    milestones,
    assignees,
    assigneesByProject,
    projectLabels,
    taskLabels,
    labelUsage,
    fromView,
  } = useLoaderData<typeof loader>();

  const actionData = useActionData<typeof action>();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const submit = useSubmit();
  const [activeTab, setActiveTab] = useState("description");
  const [isLabelPickerOpen, setIsLabelPickerOpen] = useState(false);
  const [isMoveDialogOpen, setIsMoveDialogOpen] = useState(false);
  const [dialogState, setDialogState] = useState<{
    readonly isOpen: boolean;
    readonly mode: "create" | "edit";
    readonly task?: WorkItemDetail | null;
    readonly defaultProjectId?: string | null;
    readonly defaultParentId?: string | null;
    readonly defaultType?: WorkItemType;
    readonly defaultStatusId?: string | null;
  }>({ isOpen: false, mode: "create" });

  const isArchived = ticket.archivedAt !== null;
  const isSubmitting =
    navigation.state === "submitting" &&
    (navigation.formData?.get("intent") === "create-task" ||
      navigation.formData?.get("intent") === "update-task");
  const isArchiving =
    navigation.state === "submitting" &&
    (navigation.formData?.get("intent") === "archive-task" ||
      navigation.formData?.get("intent") === "restore-task");
  const isSyncing =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "sync-github-task";

  const backTarget = `/aufgaben?view=${fromView}`;
  const assignedLabelIds = new Set(taskLabels.map((label) => label.id));

  useEffect(() => {
    if (actionData && actionData.ok && actionData.key) {
      if (
        actionData.intent === "create-task" ||
        actionData.intent === "move-project"
      ) {
        setDialogState({ isOpen: false, mode: "create" });
        setIsMoveDialogOpen(false);
        void navigate(`/aufgaben/${actionData.key}?from=${fromView}`);
      } else if (actionData.intent === "update-task") {
        setDialogState({ isOpen: false, mode: "create" });
      }
    }
  }, [actionData, fromView, navigate]);

  function submitFullUpdate(options: {
    readonly priority?: WorkItemPriority;
    readonly assigneeId?: string;
    readonly reporterId?: string;
    readonly milestoneId?: string;
    readonly parentId?: string;
    readonly dueAt?: string;
    readonly startAt?: string;
  }): void {
    submit(
      {
        assigneeId: options.assigneeId ?? ticket.assigneeId ?? "",
        description: ticket.description,
        dueAt: options.dueAt ?? ticket.dueAt ?? "",
        id: ticket.id,
        intent: "update-task",
        milestoneId: options.milestoneId ?? ticket.milestoneId ?? "",
        parentId: options.parentId ?? ticket.parentId ?? "",
        priority: options.priority ?? ticket.priority,
        reporterId: options.reporterId ?? ticket.createdBy,
        startAt: options.startAt ?? ticket.startAt ?? "",
        statusId: ticket.statusId,
        title: ticket.title,
      },
      { method: "post" },
    );
  }

  function handleStatusChange(nextStatusId: string): void {
    submit(
      {
        id: ticket.id,
        intent: "move-task",
        sortOrder: String(ticket.sortOrder),
        statusId: nextStatusId,
      },
      { method: "post" },
    );
  }

  function handlePriorityChange(nextPriority: string): void {
    submitFullUpdate({
      priority: nextPriority as WorkItemPriority,
    });
  }

  function handleAssigneeChange(nextAssigneeId: string): void {
    submitFullUpdate({ assigneeId: nextAssigneeId });
  }

  function handleReporterChange(nextReporterId: string): void {
    submitFullUpdate({ reporterId: nextReporterId });
  }

  function handleMilestoneChange(nextMilestoneId: string): void {
    submitFullUpdate({ milestoneId: nextMilestoneId });
  }

  function handleParentChange(nextParentId: string): void {
    submitFullUpdate({ parentId: nextParentId });
  }

  function handleDueAtChange(event: ChangeEvent<HTMLInputElement>): void {
    submitFullUpdate({ dueAt: event.currentTarget.value });
  }

  function handleStartAtChange(event: ChangeEvent<HTMLInputElement>): void {
    submitFullUpdate({ startAt: event.currentTarget.value });
  }

  function handleOpenChild(key: string): void {
    void navigate(`/aufgaben/${key}?from=${fromView}`);
  }

  function handleEdit(): void {
    setDialogState({ isOpen: true, mode: "edit", task: ticket });
  }

  function handleCreateChild(): void {
    if (ticket.type === WORK_ITEM_TYPE.INITIATIVE) {
      setDialogState({
        defaultParentId: ticket.id,
        defaultProjectId: ticket.projectId,
        defaultType: WORK_ITEM_TYPE.EPIC,
        isOpen: true,
        mode: "create",
      });
      return;
    }

    if (ticket.type === WORK_ITEM_TYPE.EPIC) {
      setDialogState({
        defaultParentId: ticket.id,
        defaultProjectId: ticket.projectId,
        defaultType: WORK_ITEM_TYPE.TASK,
        isOpen: true,
        mode: "create",
      });
      return;
    }

    setDialogState({
      defaultParentId: ticket.id,
      defaultProjectId: ticket.projectId,
      defaultType: WORK_ITEM_TYPE.SUBTASK,
      isOpen: true,
      mode: "create",
    });
  }

  const childrenTabLabel =
    ticket.type === WORK_ITEM_TYPE.INITIATIVE
      ? t("tasks.detail.containedEpics")
      : ticket.type === WORK_ITEM_TYPE.EPIC
        ? t("tasks.detail.containedTasks")
        : t("tasks.tabs.subtasks");
  const showChildren = ticket.type !== WORK_ITEM_TYPE.SUBTASK;
  const createChildLabel =
    ticket.type === WORK_ITEM_TYPE.INITIATIVE
      ? t("tasks.detail.createEpic")
      : ticket.type === WORK_ITEM_TYPE.EPIC
        ? t("tasks.create.trigger")
        : t("tasks.actions.createSubtask");

  const epicOptions = projectWorkItems.filter(
    (item) =>
      item.type === WORK_ITEM_TYPE.EPIC &&
      item.id !== ticket.id &&
      item.archivedAt === null,
  );
  const initiativeOptions = projectWorkItems.filter(
    (item) =>
      item.type === WORK_ITEM_TYPE.INITIATIVE &&
      item.id !== ticket.id &&
      item.archivedAt === null,
  );
  const showEpicSelect = ticket.type === WORK_ITEM_TYPE.TASK;
  const showInitiativeSelect = ticket.type === WORK_ITEM_TYPE.EPIC;

  return (
    <PageContent>
      <div className="mx-auto flex w-full max-w-6xl flex-col">
        <nav
          aria-label={t("tasks.detail.breadcrumb")}
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <Link
            className="hover:text-foreground hover:underline"
            to={backTarget}
            prefetch="intent"
          >
            {t("tasks.title")}
          </Link>
          <span aria-hidden="true">›</span>
          <Link
            className="hover:text-foreground hover:underline"
            to={`/projekte/${project.id}`}
            prefetch="intent"
          >
            {project.name}
          </Link>
          <span aria-hidden="true">›</span>
          <span className="font-semibold text-foreground">{ticket.key}</span>
        </nav>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <TaskTypeBadge type={ticket.type} />
              <span className="text-xs font-semibold text-muted-foreground">
                {ticket.key}
              </span>
              {isArchived ? (
                <span className="rounded-md bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">
                  {t("tasks.archived.badge")}
                </span>
              ) : null}
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
              {ticket.title}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              className="gap-1.5"
              onClick={() => void navigate(backTarget)}
              type="button"
              variant="ghost"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              {t("tasks.detail.back")}
            </Button>
            <Button
              className="gap-1.5"
              disabled={isArchived}
              onClick={handleEdit}
              type="button"
            >
              <Edit3 className="size-4" aria-hidden="true" />
              {t("tasks.actions.edit")}
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Select
            ariaLabel={t("tasks.fields.status")}
            value={ticket.statusId}
            onValueChange={handleStatusChange}
            disabled={isArchived}
            options={statuses.map((status) => ({
              value: status.id,
              label: status.name,
            }))}
          />

          <Select
            ariaLabel={t("tasks.fields.priority")}
            value={ticket.priority}
            onValueChange={handlePriorityChange}
            disabled={isArchived}
            options={[
              { value: WORK_ITEM_PRIORITY.LOW, label: t("tasks.priority.low") },
              {
                value: WORK_ITEM_PRIORITY.NORMAL,
                label: t("tasks.priority.normal"),
              },
              {
                value: WORK_ITEM_PRIORITY.HIGH,
                label: t("tasks.priority.high"),
              },
              {
                value: WORK_ITEM_PRIORITY.URGENT,
                label: t("tasks.priority.urgent"),
              },
            ]}
          />

          <Select
            ariaLabel={t("tasks.fields.assignee")}
            value={ticket.assigneeId ?? ""}
            onValueChange={handleAssigneeChange}
            disabled={isArchived}
            options={[
              { value: "", label: t("tasks.unassigned") },
              ...assignees.map((assignee) => ({
                value: assignee.id,
                label: assignee.displayName,
              })),
            ]}
          />
        </div>

        {isArchived ? (
          <div className="mt-4 flex items-center justify-between gap-2 rounded-xl bg-orange-50 p-3 text-xs">
            <span className="font-semibold text-foreground">
              {t("tasks.archived.banner")}
            </span>
            <Form method="post">
              <input name="intent" type="hidden" value="restore-task" />
              <input name="id" type="hidden" value={ticket.id} />
              <Button
                className="h-8 px-3 text-xs"
                disabled={isArchiving}
                type="submit"
                variant="ghost"
              >
                {t("tasks.archived.restore")}
              </Button>
            </Form>
          </div>
        ) : null}

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0">
            <Tabs
              value={activeTab}
              onValueChange={setActiveTab}
              ariaLabel={ticket.key}
              tabs={[
                { value: "description", label: t("tasks.tabs.description") },
                ...(showChildren
                  ? [
                      {
                        value: "children",
                        label: (
                          <span className="inline-flex items-center gap-1.5">
                            {childrenTabLabel}
                            <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs text-foreground">
                              {children.length}
                            </span>
                          </span>
                        ),
                      },
                    ]
                  : []),
                { value: "activity", label: t("tasks.tabs.activity") },
              ]}
            />

            <div className="mt-4">
              {activeTab === "description" ? (
                <div className="rounded-xl bg-muted/40 p-5 text-sm leading-relaxed text-muted-foreground">
                  {ticket.description ? (
                    <p className="whitespace-pre-wrap">{ticket.description}</p>
                  ) : (
                    <p className="italic text-muted-foreground/70">
                      {t("tasks.none")}
                    </p>
                  )}
                </div>
              ) : null}

              {activeTab === "children" && showChildren ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between pb-1">
                    <span className="text-xs font-semibold text-muted-foreground">
                      {ticket.subtaskCompleted} / {ticket.subtaskTotal}{" "}
                      {t("tasks.detail.doneSuffix")}
                    </span>
                    {!isArchived ? (
                      <Button
                        className="h-8 gap-1.5 px-3 text-xs"
                        onClick={handleCreateChild}
                        type="button"
                        variant="outline"
                      >
                        <Plus className="size-3.5" aria-hidden="true" />
                        {createChildLabel}
                      </Button>
                    ) : null}
                  </div>
                  {children.length === 0 ? (
                    <p className="rounded-xl bg-muted/40 p-8 text-center text-xs text-muted-foreground">
                      {t("tasks.none")}
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {children.map((child) => (
                        <li key={child.id}>
                          <button
                            className="flex w-full items-center gap-2 rounded-xl bg-muted/40 px-3 py-2.5 text-left text-sm hover:bg-muted"
                            onClick={() => handleOpenChild(child.key)}
                            type="button"
                          >
                            <TaskTypeBadge type={child.type} />
                            <span className="shrink-0 font-mono text-xs font-semibold text-muted-foreground">
                              {child.key}
                            </span>
                            <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                              {child.title}
                            </span>
                            <TaskStatusBadge
                              statusKey={child.statusKey}
                              statusName={child.statusName}
                            />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}

              {activeTab === "activity" ? (
                <TaskActivityList history={history} />
              ) : null}
            </div>
          </div>

          <aside className="flex min-w-0 flex-col gap-3 text-xs">
            <div className="flex flex-col gap-3 rounded-xl bg-muted/40 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="select-none font-medium text-muted-foreground">
                  {t("tasks.fields.type")}
                </span>
                <TaskTypeBadge type={ticket.type} />
              </div>

              <div className="flex items-center justify-between gap-2">
                <span
                  className="select-none font-medium text-muted-foreground"
                  id="detail-status"
                >
                  {t("tasks.fields.status")}
                </span>
                <Select
                  ariaLabel={t("tasks.fields.status")}
                  value={ticket.statusId}
                  onValueChange={handleStatusChange}
                  disabled={isArchived}
                  options={statuses.map((status) => ({
                    value: status.id,
                    label: status.name,
                  }))}
                />
              </div>

              <div className="flex items-center justify-between gap-2">
                <span
                  className="select-none font-medium text-muted-foreground"
                  id="detail-priority"
                >
                  {t("tasks.fields.priority")}
                </span>
                <Select
                  ariaLabel={t("tasks.fields.priority")}
                  value={ticket.priority}
                  onValueChange={handlePriorityChange}
                  disabled={isArchived}
                  options={[
                    {
                      value: WORK_ITEM_PRIORITY.LOW,
                      label: t("tasks.priority.low"),
                    },
                    {
                      value: WORK_ITEM_PRIORITY.NORMAL,
                      label: t("tasks.priority.normal"),
                    },
                    {
                      value: WORK_ITEM_PRIORITY.HIGH,
                      label: t("tasks.priority.high"),
                    },
                    {
                      value: WORK_ITEM_PRIORITY.URGENT,
                      label: t("tasks.priority.urgent"),
                    },
                  ]}
                />
              </div>

              <div className="flex items-center justify-between gap-2">
                <span
                  className="select-none font-medium text-muted-foreground"
                  id="detail-assignee"
                >
                  {t("tasks.fields.assignee")}
                </span>
                <Select
                  ariaLabel={t("tasks.fields.assignee")}
                  value={ticket.assigneeId ?? ""}
                  onValueChange={handleAssigneeChange}
                  disabled={isArchived}
                  options={[
                    { value: "", label: t("tasks.unassigned") },
                    ...assignees.map((assignee) => ({
                      value: assignee.id,
                      label: assignee.displayName,
                    })),
                  ]}
                />
              </div>

              <div className="flex items-center justify-between gap-2">
                <span
                  className="select-none font-medium text-muted-foreground"
                  id="detail-reporter"
                >
                  {t("tasks.fields.reporter")}
                </span>
                <Select
                  ariaLabel={t("tasks.fields.reporter")}
                  value={ticket.createdBy}
                  onValueChange={handleReporterChange}
                  disabled={isArchived}
                  options={assignees.map((assignee) => ({
                    value: assignee.id,
                    label: assignee.displayName,
                  }))}
                />
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="select-none font-medium text-muted-foreground">
                  {t("tasks.fields.project")}
                </span>
                <span className="inline-flex items-center gap-2 font-medium text-foreground">
                  {project.name}
                  {!isArchived ? (
                    <button
                      className="font-semibold text-primary hover:underline"
                      onClick={() => setIsMoveDialogOpen(true)}
                      type="button"
                    >
                      {t("tasks.move.open")}
                    </button>
                  ) : null}
                </span>
              </div>

              {parent ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="select-none font-medium text-muted-foreground">
                    {ticket.type === WORK_ITEM_TYPE.SUBTASK
                      ? t("tasks.fields.parentTask")
                      : ticket.type === WORK_ITEM_TYPE.EPIC
                        ? t("tasks.fields.parentInitiative")
                        : t("tasks.fields.parentEpic")}
                  </span>
                  <button
                    className="font-semibold text-primary hover:underline"
                    onClick={() => handleOpenChild(parent.key)}
                    type="button"
                  >
                    {parent.key}
                  </button>
                </div>
              ) : null}

              {showEpicSelect ? (
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="select-none font-medium text-muted-foreground"
                    id="detail-epic"
                  >
                    {t("tasks.fields.parentEpic")}
                  </span>
                  <Select
                    ariaLabel={t("tasks.fields.parentEpic")}
                    value={ticket.parentId ?? ""}
                    onValueChange={handleParentChange}
                    disabled={isArchived}
                    options={[
                      { value: "", label: t("tasks.none") },
                      ...epicOptions.map((option) => ({
                        value: option.id,
                        label: `${option.key}: ${option.title}`,
                      })),
                    ]}
                  />
                </div>
              ) : null}

              {showInitiativeSelect ? (
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="select-none font-medium text-muted-foreground"
                    id="detail-initiative"
                  >
                    {t("tasks.fields.parentInitiative")}
                  </span>
                  <Select
                    ariaLabel={t("tasks.fields.parentInitiative")}
                    value={ticket.parentId ?? ""}
                    onValueChange={handleParentChange}
                    disabled={isArchived}
                    options={[
                      { value: "", label: t("tasks.none") },
                      ...initiativeOptions.map((option) => ({
                        value: option.id,
                        label: `${option.key}: ${option.title}`,
                      })),
                    ]}
                  />
                </div>
              ) : null}

              <div className="flex items-center justify-between gap-2">
                <span
                  className="select-none font-medium text-muted-foreground"
                  id="detail-milestone"
                >
                  {t("tasks.fields.milestone")}
                </span>
                <Select
                  ariaLabel={t("tasks.fields.milestone")}
                  value={ticket.milestoneId ?? ""}
                  onValueChange={handleMilestoneChange}
                  disabled={isArchived}
                  options={[
                    { value: "", label: t("tasks.none") },
                    ...milestones.map((milestone) => ({
                      value: milestone.id,
                      label: milestone.name,
                    })),
                  ]}
                />
              </div>

              <div className="flex items-center justify-between gap-2">
                <span
                  className="select-none font-medium text-muted-foreground"
                  id="detail-labels"
                >
                  {t("tasks.fields.labels")}
                </span>
                <span className="inline-flex max-w-48 flex-wrap items-center justify-end gap-1">
                  {taskLabels.map((label) => (
                    <TaskLabelPill key={label.id} label={label} />
                  ))}
                  {!isArchived ? (
                    <button
                      aria-label={t("tasks.labels.editLabels")}
                      className="inline-flex size-6 items-center justify-center rounded-lg bg-surface text-muted-foreground shadow-xs hover:bg-surface-hover hover:text-foreground"
                      onClick={() => setIsLabelPickerOpen(true)}
                      type="button"
                    >
                      <Plus className="size-3.5" aria-hidden="true" />
                    </button>
                  ) : null}
                </span>
              </div>

              <div className="flex items-center justify-between gap-2">
                <label
                  className="select-none font-medium text-muted-foreground"
                  htmlFor="detail-start"
                >
                  {t("tasks.fields.startAt")}
                </label>
                <span className="inline-flex max-w-40 items-center gap-1.5">
                  <Calendar
                    className="size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <input
                    id="detail-start"
                    type="date"
                    className="h-8 w-full rounded-lg bg-surface px-2 font-medium text-foreground shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
                    disabled={isArchived}
                    value={ticket.startAt ?? ""}
                    onChange={handleStartAtChange}
                  />
                </span>
              </div>

              <div className="flex items-center justify-between gap-2">
                <label
                  className="select-none font-medium text-muted-foreground"
                  htmlFor="detail-due"
                >
                  {t("tasks.fields.dueAt")}
                </label>
                <span className="inline-flex max-w-40 items-center gap-1.5">
                  <Calendar
                    className="size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <input
                    id="detail-due"
                    type="date"
                    className="h-8 w-full rounded-lg bg-surface px-2 font-medium text-foreground shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
                    disabled={isArchived}
                    value={ticket.dueAt ?? ""}
                    onChange={handleDueAtChange}
                  />
                </span>
              </div>

              <div className="mt-1 pt-3">
                <div className="flex items-center justify-between font-medium">
                  <span className="text-muted-foreground">
                    {t("tasks.progress")}
                  </span>
                  <span className="text-foreground">
                    {ticket.subtaskTotal > 0
                      ? `${ticket.subtaskCompleted} / ${ticket.subtaskTotal} (${ticket.progressPercentage} %)`
                      : `${ticket.progressPercentage} %`}
                  </span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-300"
                    style={{ width: `${ticket.progressPercentage}%` }}
                  />
                </div>
              </div>
            </div>

            <TaskGitHubDetails
              isSyncing={isSyncing}
              pullRequests={pullRequests}
              task={ticket}
            />

            {!isArchived ? (
              <Form method="post">
                <input name="intent" type="hidden" value="archive-task" />
                <input name="id" type="hidden" value={ticket.id} />
                <Button
                  className="w-full gap-1.5 text-destructive hover:text-destructive"
                  disabled={isArchiving}
                  type="submit"
                  variant="ghost"
                >
                  {isArchiving
                    ? t("tasks.actions.archiving")
                    : t("tasks.actions.archive")}
                </Button>
              </Form>
            ) : (
              <Form method="post">
                <input name="intent" type="hidden" value="restore-task" />
                <input name="id" type="hidden" value={ticket.id} />
                <Button
                  className="w-full gap-1.5"
                  disabled={isArchiving}
                  type="submit"
                  variant="outline"
                >
                  {t("tasks.archived.restore")}
                </Button>
              </Form>
            )}
          </aside>
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

        <TaskFormDialog
          assignees={assignees}
          defaultParentId={dialogState.defaultParentId}
          defaultProjectId={dialogState.defaultProjectId}
          defaultStatusId={dialogState.defaultStatusId}
          defaultType={dialogState.defaultType}
          error={actionData && !actionData.ok ? actionData.error : null}
          existingWorkItems={projectWorkItems}
          initialTask={dialogState.task}
          isOpen={dialogState.isOpen}
          isSubmitting={isSubmitting}
          milestones={milestones}
          mode={dialogState.mode}
          onOpenChange={(open) =>
            setDialogState((prev) => ({ ...prev, isOpen: open }))
          }
          projects={projects}
          statuses={statuses}
        />

        <LabelPicker
          assignedLabelIds={assignedLabelIds}
          isOpen={isLabelPickerOpen}
          isSubmitting={isSyncing}
          labelUsage={labelUsage}
          onOpenChange={setIsLabelPickerOpen}
          projectId={ticket.projectId}
          projectLabels={projectLabels}
          workItemId={ticket.id}
        />

        {isMoveDialogOpen ? (
          <TaskMoveDialog
            assigneesByProject={assigneesByProject}
            isOpen={isMoveDialogOpen}
            isSubmitting={isSyncing}
            milestones={milestones}
            onOpenChange={setIsMoveDialogOpen}
            projects={projects}
            task={ticket}
            taskLabels={taskLabels}
            workItems={projectWorkItems}
          />
        ) : null}
      </div>
    </PageContent>
  );
}
