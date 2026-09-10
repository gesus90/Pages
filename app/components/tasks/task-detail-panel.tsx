import {
  Archive,
  Calendar,
  CheckCircle2,
  Circle,
  Edit3,
  ExternalLink,
  Folder,
  Link as LinkIcon,
  MapPin,
  Milestone as MilestoneIcon,
  Plus,
  RotateCcw,
  User as UserIcon,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, useSubmit } from "react-router";

import { Button } from "@/app/components/ui/button";
import { FloatingPanel } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";
import { TaskTypeBadge } from "@/app/components/tasks/task-badges";
import { DetailSection } from "@/app/components/tasks/detail-section";
import { GitHubSyncBadge } from "@/app/components/tasks/github-sync-badge";
import { LabelPicker } from "@/app/components/tasks/label-picker";
import { TaskChecklist } from "@/app/components/tasks/task-checklist";
import { TaskLabelPill } from "@/app/components/tasks/task-labels";
import { TaskLinks } from "@/app/components/tasks/task-links";
import { TaskMoveDialog } from "@/app/components/tasks/task-move-dialog";
import { cn } from "@/app/lib/cn";
import { WORK_ITEM_PRIORITY, WORK_ITEM_TYPE } from "@/definition/Task";

import styles from "./task-detail-panel.module.css";

import type { GitHubPullRequest } from "@/definition/GitHub";
import type { Project } from "@/definition/Project";
import type {
  Milestone,
  ProjectLabel,
  WorkItemChecklistItem,
  WorkItemDetail,
  WorkItemHistory,
  WorkItemLink,
  WorkItemPriority,
  WorkflowStatus,
} from "@/definition/Task";
import type { User } from "@/definition/User";

interface TaskDetailPanelProps {
  readonly task: WorkItemDetail;
  readonly subtasks: readonly WorkItemDetail[];
  readonly history: readonly WorkItemHistory[];
  readonly checklist?: readonly WorkItemChecklistItem[];
  readonly links?: readonly WorkItemLink[];
  readonly pullRequests?: readonly GitHubPullRequest[];
  readonly statuses: readonly WorkflowStatus[];
  readonly assignees?: readonly User[];
  readonly milestones?: readonly Milestone[];
  readonly projects?: readonly Project[];
  readonly workItems?: readonly WorkItemDetail[];
  readonly projectLabels?: readonly ProjectLabel[];
  readonly taskLabels?: readonly ProjectLabel[];
  readonly labelUsage?: Readonly<Record<string, number>>;
  readonly assigneesByProject?: Readonly<Record<string, readonly User[]>>;
  readonly onClose: () => void;
  readonly onEdit: (task: WorkItemDetail) => void;
  readonly onOpenTask: (key: string) => void;
  readonly onCreateSubtask: (parentTask: WorkItemDetail) => void;
  readonly onSelectTask: (key: string) => void;
  readonly isArchiving?: boolean;
  readonly isSyncing?: boolean;
}

interface ParentSelect {
  readonly label: string;
  readonly options: readonly WorkItemDetail[];
}

/** Renders the complete floating ticket panel with independent content panes. */
export function TaskDetailPanel({
  task,
  subtasks,
  checklist = [],
  links = [],
  statuses,
  assignees = [],
  milestones = [],
  projects = [],
  workItems = [],
  projectLabels = [],
  taskLabels = [],
  labelUsage,
  assigneesByProject = {},
  onClose,
  onCreateSubtask,
  onEdit,
  onOpenTask,
  onSelectTask,
  isArchiving = false,
  isSyncing = false,
}: TaskDetailPanelProps): React.ReactElement {
  const { t } = useTranslation();
  const submit = useSubmit();
  const [isLabelPickerOpen, setIsLabelPickerOpen] = useState(false);
  const [isMoveDialogOpen, setIsMoveDialogOpen] = useState(false);
  const [pendingProjectId, setPendingProjectId] = useState("");
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState(task.description);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [isAddingLink, setIsAddingLink] = useState(false);

  const isEpic = task.type === WORK_ITEM_TYPE.EPIC;
  const isArchived = task.archivedAt !== null;
  const availableMilestones = milestones.filter(
    (milestone) => milestone.projectId === task.projectId,
  );
  const projectAssignees = assigneesByProject?.[task.projectId] ?? assignees;
  const reporterFallback: User = {
    displayName: task.reporterName ?? task.createdBy,
    id: task.createdBy,
    isActive: true,
    role: "employee",
    username: task.createdBy,
  };
  const reporterOptions = projectAssignees.some(
    (user) => user.id === task.createdBy,
  )
    ? projectAssignees
    : [...projectAssignees, reporterFallback];

  function submitPanelUpdate(options: {
    readonly title?: string;
    readonly priority?: WorkItemPriority;
    readonly assigneeId?: string;
    readonly reporterId?: string;
    readonly milestoneId?: string;
    readonly parentId?: string;
    readonly dueAt?: string;
    readonly startAt?: string;
    readonly description?: string;
  }): void {
    submit(
      {
        assigneeId: options.assigneeId ?? task.assigneeId ?? "",
        description: options.description ?? task.description,
        dueAt: options.dueAt ?? task.dueAt ?? "",
        id: task.id,
        intent: "update-task",
        milestoneId: options.milestoneId ?? task.milestoneId ?? "",
        parentId: options.parentId ?? task.parentId ?? "",
        priority: options.priority ?? task.priority,
        reporterId: options.reporterId ?? task.createdBy,
        startAt: options.startAt ?? task.startAt ?? "",
        statusId: task.statusId,
        title: options.title ?? task.title,
      },
      { method: "post" },
    );
  }

  function handleStatusChange(nextStatusId: string): void {
    submit(
      {
        id: task.id,
        intent: "move-task",
        sortOrder: String(task.sortOrder),
        statusId: nextStatusId,
      },
      { method: "post" },
    );
  }

  function handlePriorityChange(nextPriority: string): void {
    submitPanelUpdate({
      priority: nextPriority as WorkItemPriority,
    });
  }

  function handleAssigneeChange(nextAssigneeId: string): void {
    submitPanelUpdate({ assigneeId: nextAssigneeId });
  }

  function handleReporterChange(nextReporterId: string): void {
    submitPanelUpdate({ reporterId: nextReporterId });
  }

  function handleMilestoneChange(nextMilestoneId: string): void {
    submitPanelUpdate({ milestoneId: nextMilestoneId });
  }

  function handleParentChange(nextParentId: string): void {
    submitPanelUpdate({ parentId: nextParentId });
  }

  function handleDueAtChange(event: React.ChangeEvent<HTMLInputElement>): void {
    submitPanelUpdate({ dueAt: event.currentTarget.value });
  }

  function handleStartAtChange(
    event: React.ChangeEvent<HTMLInputElement>,
  ): void {
    submitPanelUpdate({ startAt: event.currentTarget.value });
  }

  function handleProjectChange(nextProjectId: string): void {
    setPendingProjectId(nextProjectId);
    setIsMoveDialogOpen(true);
  }

  function handleMoveDialogClose(): void {
    setIsMoveDialogOpen(false);
    setPendingProjectId("");
  }

  function handleRemoveLabel(label: ProjectLabel): void {
    submit(
      { intent: "label-unassign", labelId: label.id, workItemId: task.id },
      { method: "post" },
    );
  }

  function handleToggleAddLink(): void {
    setIsAddingLink((previous) => !previous);
  }

  function handleCloseRequest(): void {
    onClose();
  }

  function handleStartEditDescription(): void {
    setDescriptionDraft(task.description);
    setIsEditingDescription(true);
  }

  function handleCancelEditDescription(): void {
    setIsEditingDescription(false);
    setDescriptionDraft(task.description);
  }

  function handleSaveDescription(): void {
    submitPanelUpdate({ description: descriptionDraft });
    setIsEditingDescription(false);
  }

  function handleStartEditTitle(): void {
    setTitleDraft(task.title);
    setIsEditingTitle(true);
  }

  function handleCancelEditTitle(): void {
    setIsEditingTitle(false);
    setTitleDraft(task.title);
  }

  function handleSaveTitle(): void {
    const trimmedTitle = titleDraft.trim();

    if (trimmedTitle && trimmedTitle !== task.title) {
      submitPanelUpdate({ title: trimmedTitle });
    }

    setIsEditingTitle(false);
  }

  function handleTitleKeyDown(
    event: React.KeyboardEvent<HTMLInputElement>,
  ): void {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSaveTitle();
    }

    if (event.key === "Escape") {
      event.preventDefault();
      handleCancelEditTitle();
    }
  }

  function handleTitleDoubleClick(): void {
    if (!isArchived) {
      handleStartEditTitle();
    }
  }

  function getParentSelect(): ParentSelect | null {
    if (task.type === WORK_ITEM_TYPE.SUBTASK) {
      return null;
    }

    if (task.type === WORK_ITEM_TYPE.EPIC) {
      return {
        label: t("tasks.fields.parentInitiative"),
        options: workItems.filter(
          (item) =>
            item.projectId === task.projectId &&
            item.type === WORK_ITEM_TYPE.INITIATIVE &&
            item.id !== task.id,
        ),
      };
    }

    if (task.type === WORK_ITEM_TYPE.INITIATIVE) {
      return null;
    }

    return {
      label: t("tasks.fields.parentEpic"),
      options: workItems.filter(
        (item) =>
          item.projectId === task.projectId &&
          item.type === WORK_ITEM_TYPE.EPIC &&
          item.id !== task.id,
      ),
    };
  }

  /**
   * Resolves the ancestor chain of the current ticket, top-down.
   *
   * @returns Ancestors from the root down to the direct parent.
   */
  function getAncestorChain(): WorkItemDetail[] {
    const byId = new Map(workItems.map((item) => [item.id, item]));
    const chain: WorkItemDetail[] = [];
    const visited = new Set<string>([task.id]);
    let parentId = task.parentId;
    let depth = 0;

    while (parentId && depth < 10) {
      if (visited.has(parentId)) {
        break;
      }

      visited.add(parentId);

      const parent = byId.get(parentId);

      if (!parent) {
        break;
      }

      chain.unshift(parent);
      parentId = parent.parentId;
      depth += 1;
    }

    return chain;
  }

  function getPathDotClass(type: WorkItemDetail["type"]): string {
    if (type === WORK_ITEM_TYPE.INITIATIVE) {
      return "border-violet-500";
    }

    if (type === WORK_ITEM_TYPE.EPIC) {
      return "border-blue-500";
    }

    return "border-emerald-500";
  }

  const parentSelect = getParentSelect();
  const pathChain = getAncestorChain();
  const assignedLabelIds = new Set(taskLabels.map((label) => label.id));
  const showChildren = task.type !== WORK_ITEM_TYPE.SUBTASK;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape" && !event.defaultPrevented) {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const subtasksSection = showChildren ? (
    <DetailSection
      title={
        isEpic ? t("tasks.detail.containedTasks") : t("tasks.tabs.subtasks")
      }
      trailing={
        !isArchived ? (
          <Button
            className="h-8 shrink-0 gap-1.5 px-3 text-xs"
            onClick={() => onCreateSubtask(task)}
            type="button"
            variant="outline"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            {isEpic
              ? t("tasks.create.trigger")
              : t("tasks.actions.createSubtask")}
          </Button>
        ) : (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground">
            {task.subtaskCompleted} / {task.subtaskTotal}
          </span>
        )
      }
    >
      {subtasks.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">
          {t("tasks.none")}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {subtasks.map((child) => (
            <li key={child.id}>
              <button
                className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm transition-colors hover:bg-muted/60"
                onClick={() => onSelectTask(child.key)}
                onDoubleClick={() => onOpenTask(child.key)}
                type="button"
              >
                {child.isDone ? (
                  <CheckCircle2
                    className="size-4 shrink-0 text-emerald-500"
                    aria-hidden="true"
                  />
                ) : (
                  <Circle
                    className="size-4 shrink-0 text-muted-foreground/60"
                    aria-hidden="true"
                  />
                )}
                <span className="shrink-0 text-xs font-semibold text-muted-foreground">
                  {child.key}
                </span>
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate font-medium",
                    child.isDone
                      ? "text-muted-foreground line-through"
                      : "text-foreground",
                  )}
                >
                  {child.title}
                </span>
                <span
                  className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground select-none"
                  title={child.assigneeName ?? t("tasks.unassigned")}
                >
                  {child.assigneeName
                    ? child.assigneeName.trim().charAt(0).toUpperCase()
                    : "?"}
                </span>
                <span className="w-16 shrink-0 text-right text-xs font-medium text-muted-foreground">
                  {child.dueAt ?? ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </DetailSection>
  ) : null;

  return (
    <>
      <div aria-hidden="true" className={styles.backdrop} />
      <div className={styles.positioner}>
        <FloatingPanel
          aria-label={`${task.key} ${task.title}`}
          aria-modal="false"
          className={cn(
            styles.panel,
            "pointer-events-auto h-full max-h-none w-full overflow-hidden p-0",
          )}
          role="dialog"
        >
          <header className="shrink-0 px-5 pt-5 sm:px-7 sm:pt-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
                <TaskTypeBadge type={task.type} />
                <span className="font-semibold">{task.key}</span>
                {task.parentKey && task.parentTitle ? (
                  <button
                    className="flex min-w-0 items-center gap-1 truncate hover:text-foreground hover:underline"
                    onClick={() => onSelectTask(task.parentKey!)}
                    type="button"
                  >
                    <Folder className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="shrink-0 font-semibold">
                      {task.parentKey}
                    </span>
                    <span className="min-w-0 truncate">{task.parentTitle}</span>
                  </button>
                ) : (
                  <span className="flex min-w-0 items-center gap-1 truncate">
                    <Folder className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 truncate">{task.projectName}</span>
                  </span>
                )}
                {isArchived ? (
                  <span className="shrink-0 rounded-md bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">
                    {t("tasks.archived.badge")}
                  </span>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {!isArchived ? (
                  <Button
                    className="h-9 gap-1.5 px-3 text-xs"
                    onClick={() => onEdit(task)}
                    type="button"
                    variant="outline"
                  >
                    {t("tasks.edit.trigger")}
                  </Button>
                ) : null}
                <Select
                  ariaLabel={t("tasks.fields.status")}
                  className="h-9 font-semibold"
                  disabled={isArchived}
                  onValueChange={handleStatusChange}
                  options={statuses.map((status) => ({
                    label: status.name,
                    value: status.id,
                  }))}
                  value={task.statusId}
                />
                <Button
                  aria-label={t("tasks.actions.close")}
                  className="size-9 min-h-0 p-0 text-muted-foreground hover:text-foreground"
                  onClick={handleCloseRequest}
                  type="button"
                  variant="ghost"
                >
                  <X className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </div>

            <div className="group mt-3 flex items-start gap-2">
              {!isArchived && !isEditingTitle ? (
                <button
                  aria-label={t("tasks.actions.editTitle")}
                  className="mt-1.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-all group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100"
                  onClick={handleStartEditTitle}
                  type="button"
                >
                  <Edit3 className="size-3.5" aria-hidden="true" />
                </button>
              ) : null}
              {isEditingTitle ? (
                <div className="flex flex-1 items-start gap-2">
                  <Input
                    autoFocus
                    className="flex-1 text-xl font-semibold sm:text-2xl"
                    onChange={(event) => setTitleDraft(event.target.value)}
                    onKeyDown={handleTitleKeyDown}
                    value={titleDraft}
                  />
                  <Button
                    className="h-9 gap-1.5 px-3 text-xs"
                    onClick={handleSaveTitle}
                    type="button"
                  >
                    {t("tasks.actions.save")}
                  </Button>
                  <Button
                    className="h-9 gap-1.5 px-3 text-xs"
                    onClick={handleCancelEditTitle}
                    type="button"
                    variant="ghost"
                  >
                    {t("tasks.actions.cancel")}
                  </Button>
                </div>
              ) : (
                <div className="min-w-0 flex-1">
                  <h2
                    className="cursor-text text-xl font-semibold tracking-tight text-foreground transition-colors sm:text-2xl"
                    onDoubleClick={handleTitleDoubleClick}
                  >
                    {task.title}
                  </h2>
                  {!isArchived ? (
                    <p className="mt-0.5 text-xs text-muted-foreground select-none">
                      {t("tasks.detail.doubleClickHint")}
                    </p>
                  ) : null}
                </div>
              )}
            </div>

            {isArchived ? (
              <div className="mt-4 flex items-center justify-between gap-2 rounded-xl bg-orange-50 px-4 py-2 text-xs">
                <span className="font-semibold text-foreground">
                  {t("tasks.archived.banner")}
                </span>
                <Form method="post">
                  <input name="intent" type="hidden" value="restore-task" />
                  <input name="id" type="hidden" value={task.id} />
                  <Button
                    className="h-8 gap-1.5 px-3 text-xs"
                    disabled={isArchiving}
                    type="submit"
                    variant="ghost"
                  >
                    <RotateCcw className="size-3.5" aria-hidden="true" />
                    {t("tasks.archived.restore")}
                  </Button>
                </Form>
              </div>
            ) : null}
          </header>

          <div
            className={cn(
              styles.body,
              "mt-5 grid min-h-0 flex-1 grid-rows-2 gap-3 p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_23rem] lg:grid-rows-1",
            )}
          >
            <VerticalScrollArea
              contentClassName="gap-3 pb-2"
              viewportClassName="pr-1 sm:pr-2"
            >
              <DetailSection
                title={t("tasks.tabs.description")}
                trailing={
                  !isEditingDescription && !isArchived ? (
                    <button
                      aria-label={t("tasks.detail.editDescription")}
                      className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors hover:text-foreground"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleStartEditDescription();
                      }}
                      type="button"
                    >
                      <Edit3 className="size-3.5" aria-hidden="true" />
                    </button>
                  ) : undefined
                }
              >
                {isEditingDescription ? (
                  <div className="flex flex-col gap-2">
                    <Textarea
                      autoFocus
                      className="min-h-40 text-sm"
                      onChange={(event) =>
                        setDescriptionDraft(event.target.value)
                      }
                      value={descriptionDraft}
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        className="h-8 px-3 text-xs"
                        onClick={handleCancelEditDescription}
                        type="button"
                        variant="ghost"
                      >
                        {t("tasks.actions.cancel")}
                      </Button>
                      <Button
                        className="h-8 px-3 text-xs"
                        onClick={handleSaveDescription}
                        type="button"
                      >
                        {t("tasks.actions.save")}
                      </Button>
                    </div>
                  </div>
                ) : task.description ? (
                  <p className="text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
                    {task.description}
                  </p>
                ) : (
                  <p className="text-sm italic text-muted-foreground/70">
                    {t("tasks.none")}
                  </p>
                )}
              </DetailSection>

              <DetailSection
                title={t("tasks.checklist.title")}
                trailing={
                  checklist.length > 0 ? (
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground">
                      {checklist.filter((item) => item.isDone).length} /{" "}
                      {checklist.length}
                    </span>
                  ) : undefined
                }
              >
                <TaskChecklist
                  isArchived={isArchived}
                  isSubmitting={isSyncing}
                  items={checklist}
                  workItemId={task.id}
                />
              </DetailSection>

              {subtasksSection}
            </VerticalScrollArea>

            <VerticalScrollArea
              contentClassName="gap-3 pb-2 text-xs"
              viewportClassName="pr-1 sm:pr-2"
            >
              <DetailSection title={t("tasks.detail.keyDetails")}>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                  <dt className="text-muted-foreground">
                    {t("tasks.fields.priority")}
                  </dt>
                  <dt className="text-muted-foreground">
                    {t("tasks.fields.labels")}
                  </dt>
                  <dd className="min-w-0">
                    <Select
                      ariaLabel={t("tasks.fields.priority")}
                      className="w-full min-w-0"
                      disabled={isArchived}
                      onValueChange={handlePriorityChange}
                      options={[
                        {
                          label: t("tasks.priority.low"),
                          value: WORK_ITEM_PRIORITY.LOW,
                        },
                        {
                          label: t("tasks.priority.normal"),
                          value: WORK_ITEM_PRIORITY.NORMAL,
                        },
                        {
                          label: t("tasks.priority.high"),
                          value: WORK_ITEM_PRIORITY.HIGH,
                        },
                        {
                          label: t("tasks.priority.urgent"),
                          value: WORK_ITEM_PRIORITY.URGENT,
                        },
                      ]}
                      value={task.priority}
                    />
                  </dd>
                  <dd className="flex min-w-0 flex-wrap items-center gap-1">
                    {taskLabels.map((label) => (
                      <TaskLabelPill
                        key={label.id}
                        label={label}
                        onRemove={
                          isArchived
                            ? undefined
                            : () => handleRemoveLabel(label)
                        }
                      />
                    ))}
                    <button
                      aria-label={t("tasks.labels.editLabels")}
                      className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
                      disabled={isArchived}
                      onClick={() => setIsLabelPickerOpen(true)}
                      type="button"
                    >
                      <Plus className="size-3.5" aria-hidden="true" />
                    </button>
                  </dd>
                </dl>
              </DetailSection>

              <DetailSection title={t("tasks.detail.details")}>
                <dl className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">
                      {t("tasks.fields.assignee")}
                    </dt>
                    <dd className="flex min-w-0 items-center gap-1.5">
                      <UserIcon
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <Select
                        ariaLabel={t("tasks.fields.assignee")}
                        className="min-w-0"
                        disabled={isArchived}
                        onValueChange={handleAssigneeChange}
                        options={[
                          { label: t("tasks.unassigned"), value: "" },
                          ...projectAssignees.map((assignee) => ({
                            label: assignee.displayName,
                            value: assignee.id,
                          })),
                        ]}
                        value={task.assigneeId ?? ""}
                      />
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">
                      {t("tasks.fields.reporter")}
                    </dt>
                    <dd>
                      <Select
                        ariaLabel={t("tasks.fields.reporter")}
                        disabled={isArchived}
                        onValueChange={handleReporterChange}
                        options={reporterOptions.map((reporter) => ({
                          label: reporter.displayName,
                          value: reporter.id,
                        }))}
                        value={task.createdBy}
                      />
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">
                      {t("tasks.fields.project")}
                    </dt>
                    <dd className="flex min-w-0 items-center gap-1.5">
                      <Folder
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <Select
                        ariaLabel={t("tasks.fields.project")}
                        className="min-w-0"
                        disabled={isArchived || projects.length === 0}
                        onValueChange={handleProjectChange}
                        options={
                          projects.length === 0
                            ? [
                                {
                                  label: task.projectName,
                                  value: task.projectId,
                                },
                              ]
                            : projects.map((project) => ({
                                label: project.name,
                                value: project.id,
                              }))
                        }
                        value={task.projectId}
                      />
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">
                      {t("tasks.fields.milestone")}
                    </dt>
                    <dd className="flex min-w-0 items-center gap-1.5">
                      <MilestoneIcon
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <Select
                        ariaLabel={t("tasks.fields.milestone")}
                        className="min-w-0"
                        disabled={isArchived}
                        onValueChange={handleMilestoneChange}
                        options={[
                          { label: t("tasks.none"), value: "" },
                          ...availableMilestones.map((milestone) => ({
                            label: milestone.name,
                            value: milestone.id,
                          })),
                        ]}
                        value={task.milestoneId ?? ""}
                      />
                    </dd>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-xs font-medium">
                      <span className="text-muted-foreground">
                        {t("tasks.progress")}
                      </span>
                      <span className="text-foreground">
                        {task.subtaskTotal > 0
                          ? `${task.subtaskCompleted} / ${task.subtaskTotal} (${task.progressPercentage} %)`
                          : `${task.progressPercentage} %`}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-300"
                        style={{ width: `${task.progressPercentage}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">
                      {t("tasks.detail.gitStatus")}
                    </dt>
                    <dd>
                      <GitHubSyncBadge
                        githubConflict={task.githubConflict}
                        githubIssueNumber={task.githubIssueNumber}
                        githubLastError={task.githubLastError}
                        githubLastSyncAt={task.githubLastSyncAt}
                        isSyncing={isSyncing}
                        updatedAt={task.updatedAt}
                      />
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">
                      {t("tasks.detail.createdAt")}
                    </dt>
                    <dd className="font-medium text-foreground">
                      {task.createdAt}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">
                      {t("tasks.detail.updatedAt")}
                    </dt>
                    <dd className="font-medium text-foreground">
                      {task.updatedAt}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt>
                      <label
                        className="text-muted-foreground"
                        htmlFor={`task-start-${task.id}`}
                      >
                        {t("tasks.fields.startAt")}
                      </label>
                    </dt>
                    <dd className="flex min-w-0 items-center gap-1.5">
                      <Calendar
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <input
                        id={`task-start-${task.id}`}
                        className="h-8 min-w-0 rounded-lg bg-muted/60 px-2 font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
                        disabled={isArchived}
                        onChange={handleStartAtChange}
                        type="date"
                        value={task.startAt ?? ""}
                      />
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt>
                      <label
                        className="text-muted-foreground"
                        htmlFor={`task-due-${task.id}`}
                      >
                        {t("tasks.fields.dueAt")}
                      </label>
                    </dt>
                    <dd className="flex min-w-0 items-center gap-1.5">
                      <Calendar
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <input
                        id={`task-due-${task.id}`}
                        className="h-8 min-w-0 rounded-lg bg-muted/60 px-2 font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
                        disabled={isArchived}
                        onChange={handleDueAtChange}
                        type="date"
                        value={task.dueAt ?? ""}
                      />
                    </dd>
                  </div>
                </dl>
              </DetailSection>

              <DetailSection
                icon={
                  <MapPin
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                }
                title={t("tasks.path.title")}
              >
                <div className="flex flex-col gap-3">
                  <ol className="flex flex-col">
                    {[...pathChain, task].map((entry, index, all) => {
                      const isCurrent = entry.id === task.id;
                      const hasConnector = index < all.length - 1;

                      return (
                        <li
                          key={entry.id}
                          className="relative flex items-center gap-2.5 pb-3 last:pb-0"
                        >
                          {hasConnector ? (
                            <span
                              aria-hidden="true"
                              className="absolute top-6 bottom-0 left-[5px] w-px bg-border"
                            />
                          ) : null}
                          <span
                            aria-hidden="true"
                            className={cn(
                              "size-3 shrink-0 rounded-full border-2 bg-surface",
                              getPathDotClass(entry.type),
                            )}
                          />
                          {isCurrent ? (
                            <span
                              aria-current="true"
                              className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg bg-muted/60 px-2 py-1.5"
                            >
                              <TaskTypeBadge type={entry.type} />
                              <span className="shrink-0 text-[11px] font-semibold text-muted-foreground">
                                {entry.key}
                              </span>
                              <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                                {entry.title}
                              </span>
                            </span>
                          ) : (
                            <button
                              className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/60"
                              onClick={() => onSelectTask(entry.key)}
                              type="button"
                            >
                              <TaskTypeBadge type={entry.type} />
                              <span className="shrink-0 text-[11px] font-semibold text-muted-foreground">
                                {entry.key}
                              </span>
                              <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                                {entry.title}
                              </span>
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                  {parentSelect || task.type === WORK_ITEM_TYPE.SUBTASK ? (
                    <dl className="flex flex-col gap-3">
                      {parentSelect ? (
                        <div className="flex items-center justify-between gap-3">
                          <dt className="text-muted-foreground">
                            {parentSelect.label}
                          </dt>
                          <dd>
                            <Select
                              ariaLabel={parentSelect.label}
                              disabled={isArchived}
                              onValueChange={handleParentChange}
                              options={[
                                { label: t("tasks.none"), value: "" },
                                ...parentSelect.options.map((option) => ({
                                  label: `${option.key}: ${option.title}`,
                                  value: option.id,
                                })),
                              ]}
                              value={task.parentId ?? ""}
                            />
                          </dd>
                        </div>
                      ) : null}
                      {task.type === WORK_ITEM_TYPE.SUBTASK &&
                      task.parentKey ? (
                        <div className="flex items-center justify-between gap-3">
                          <dt className="text-muted-foreground">
                            {t("tasks.fields.parentTask")}
                          </dt>
                          <dd>
                            <button
                              className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                              onClick={() => onSelectTask(task.parentKey!)}
                              type="button"
                            >
                              {task.parentKey}
                              <ExternalLink
                                className="size-3"
                                aria-hidden="true"
                              />
                            </button>
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                  ) : null}
                </div>
              </DetailSection>

              <DetailSection
                icon={
                  <LinkIcon
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                }
                title={t("tasks.links.section")}
                trailing={
                  !isArchived ? (
                    <Button
                      aria-label="link-section-add"
                      className="h-8 shrink-0 gap-1.5 px-3 text-xs"
                      onClick={handleToggleAddLink}
                      type="button"
                      variant="outline"
                    >
                      <Plus className="size-3.5" aria-hidden="true" />
                      {t("tasks.links.add")}
                    </Button>
                  ) : undefined
                }
              >
                <TaskLinks
                  currentWorkItemKey={task.key}
                  isAddFormOpen={isAddingLink}
                  isArchived={isArchived}
                  isSubmitting={isSyncing}
                  links={links}
                  onAddFormOpenChange={setIsAddingLink}
                  onSelectTask={onSelectTask}
                  workItemId={task.id}
                  workItems={workItems}
                />
              </DetailSection>

              {!isArchived ? (
                <Form method="post">
                  <input name="intent" type="hidden" value="archive-task" />
                  <input name="id" type="hidden" value={task.id} />
                  <Button
                    className="w-full gap-1.5 text-destructive hover:text-destructive"
                    disabled={isArchiving}
                    type="submit"
                    variant="ghost"
                  >
                    <Archive className="size-4" aria-hidden="true" />
                    {isArchiving
                      ? t("tasks.actions.archiving")
                      : t("tasks.actions.archive")}
                  </Button>
                </Form>
              ) : null}
            </VerticalScrollArea>
          </div>

          <LabelPicker
            assignedLabelIds={assignedLabelIds}
            isOpen={isLabelPickerOpen}
            isSubmitting={isSyncing}
            labelUsage={labelUsage ?? {}}
            onOpenChange={setIsLabelPickerOpen}
            projectId={task.projectId}
            projectLabels={projectLabels.filter(
              (label) => label.projectId === task.projectId,
            )}
            workItemId={task.id}
          />

          {isMoveDialogOpen ? (
            <TaskMoveDialog
              assigneesByProject={assigneesByProject}
              initialTargetProjectId={pendingProjectId}
              isOpen={isMoveDialogOpen}
              isSubmitting={isSyncing}
              milestones={milestones}
              onOpenChange={() => handleMoveDialogClose()}
              projects={projects}
              task={task}
              taskLabels={taskLabels}
              workItems={workItems}
            />
          ) : null}
        </FloatingPanel>
      </div>
    </>
  );
}
