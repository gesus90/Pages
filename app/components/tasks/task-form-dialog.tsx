import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";
import { Select } from "@/app/components/ui/select";
import { WORK_ITEM_PRIORITY, WORK_ITEM_TYPE } from "@/definition/Task";

import type { Project } from "@/definition/Project";
import type {
  Milestone,
  WorkItemDetail,
  WorkItemPriority,
  WorkItemType,
  WorkflowStatus,
} from "@/definition/Task";
import type { User } from "@/definition/User";

interface TaskFormDialogProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly mode: "create" | "edit";
  readonly initialTask?: WorkItemDetail | null;
  readonly defaultProjectId?: string | null;
  readonly defaultParentId?: string | null;
  readonly defaultType?: WorkItemType;
  readonly defaultStatusId?: string | null;
  readonly projects: readonly Project[];
  readonly statuses: readonly WorkflowStatus[];
  readonly milestones: readonly Milestone[];
  readonly assignees: readonly User[];
  readonly existingWorkItems: readonly WorkItemDetail[];
  readonly isSubmitting: boolean;
  readonly error?: string | null;
}

function reporterOptions(
  initialTask: WorkItemDetail,
  assignees: readonly User[],
): { value: string; label: string }[] {
  const reporterNotInAssignees = !assignees.some(
    (assignee) => assignee.id === initialTask.createdBy,
  );

  const baseOptions = assignees.map((assignee) => ({
    value: assignee.id,
    label: assignee.displayName,
  }));

  if (!reporterNotInAssignees) {
    return baseOptions;
  }

  return [
    {
      value: initialTask.createdBy,
      label: initialTask.reporterName ?? initialTask.createdBy,
    },
    ...baseOptions,
  ];
}

/** Modal dialog for creating and editing work items with server-enforced hierarchy rules. */
export function TaskFormDialog({
  isOpen,
  onOpenChange,
  mode,
  initialTask = null,
  defaultProjectId = null,
  defaultParentId = null,
  defaultType = WORK_ITEM_TYPE.TASK,
  defaultStatusId = null,
  projects,
  statuses,
  milestones,
  assignees,
  existingWorkItems,
  isSubmitting,
  error = null,
}: TaskFormDialogProps): React.ReactElement {
  const { t } = useTranslation();

  const fallbackProjectId = projects[0]?.id ?? "";
  const initialProjectId = initialTask
    ? initialTask.projectId
    : defaultProjectId &&
        projects.some((project) => project.id === defaultProjectId)
      ? defaultProjectId
      : fallbackProjectId;

  const [selectedProjectId, setSelectedProjectId] =
    useState<string>(initialProjectId);
  const [selectedType, setSelectedType] = useState<WorkItemType>(
    initialTask?.type ?? defaultType,
  );
  const [selectedStatusId, setSelectedStatusId] = useState<string>(
    initialTask?.statusId ?? defaultStatusId ?? "",
  );
  const [selectedPriority, setSelectedPriority] = useState<WorkItemPriority>(
    initialTask?.priority ?? WORK_ITEM_PRIORITY.NORMAL,
  );
  const [selectedAssigneeId, setSelectedAssigneeId] = useState<string>(
    initialTask?.assigneeId ?? "",
  );
  const [selectedMilestoneId, setSelectedMilestoneId] = useState<string>(
    initialTask?.milestoneId ?? "",
  );
  const [selectedParentId, setSelectedParentId] = useState<string>(
    initialTask?.parentId ?? defaultParentId ?? "",
  );
  const [selectedReporterId, setSelectedReporterId] = useState<string>(
    initialTask?.createdBy ?? "",
  );

  useEffect(() => {
    if (isOpen) {
      if (initialTask) {
        setSelectedProjectId(initialTask.projectId);
        setSelectedType(initialTask.type);
        setSelectedStatusId(initialTask.statusId);
        setSelectedPriority(initialTask.priority);
        setSelectedAssigneeId(initialTask.assigneeId ?? "");
        setSelectedMilestoneId(initialTask.milestoneId ?? "");
        setSelectedParentId(initialTask.parentId ?? "");
        setSelectedReporterId(initialTask.createdBy);
      } else {
        const resetProjectId =
          defaultProjectId &&
          projects.some((project) => project.id === defaultProjectId)
            ? defaultProjectId
            : fallbackProjectId;

        setSelectedProjectId(resetProjectId);
        setSelectedType(defaultType);
        setSelectedStatusId(defaultStatusId ?? "");
        setSelectedPriority(WORK_ITEM_PRIORITY.NORMAL);
        setSelectedAssigneeId("");
        setSelectedMilestoneId("");
        setSelectedParentId(defaultParentId ?? "");
        setSelectedReporterId("");
      }
    }
  }, [
    isOpen,
    initialTask,
    defaultProjectId,
    defaultType,
    defaultStatusId,
    fallbackProjectId,
    projects,
  ]);

  const availableMilestones = milestones.filter(
    (milestone) => milestone.projectId === selectedProjectId,
  );

  const availableInitiatives = existingWorkItems.filter(
    (item) =>
      item.projectId === selectedProjectId &&
      item.type === WORK_ITEM_TYPE.INITIATIVE &&
      (!initialTask || item.id !== initialTask.id),
  );

  const availableEpics = existingWorkItems.filter(
    (item) =>
      item.projectId === selectedProjectId &&
      item.type === WORK_ITEM_TYPE.EPIC &&
      (!initialTask || item.id !== initialTask.id),
  );

  const availableTasks = existingWorkItems.filter(
    (item) =>
      item.projectId === selectedProjectId &&
      item.type === WORK_ITEM_TYPE.TASK &&
      (!initialTask || item.id !== initialTask.id),
  );

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[min(38rem,94vw)] overflow-y-auto">
        <DialogTitle className="select-none text-lg font-semibold text-foreground">
          {mode === "create" ? t("tasks.create.title") : t("tasks.edit.title")}
        </DialogTitle>

        <Form className="mt-5 flex flex-col gap-4" method="post" noValidate>
          <input
            name="intent"
            type="hidden"
            value={mode === "create" ? "create-task" : "update-task"}
          />
          {initialTask ? (
            <input name="id" type="hidden" value={initialTask.id} />
          ) : null}
          <input name="type" type="hidden" value={selectedType} />
          <input name="projectId" type="hidden" value={selectedProjectId} />
          <input name="statusId" type="hidden" value={selectedStatusId} />
          <input name="priority" type="hidden" value={selectedPriority} />
          <input name="assigneeId" type="hidden" value={selectedAssigneeId} />
          <input name="milestoneId" type="hidden" value={selectedMilestoneId} />
          <input name="parentId" type="hidden" value={selectedParentId} />
          {mode === "edit" ? (
            <input name="reporterId" type="hidden" value={selectedReporterId} />
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label
                className="block select-none text-sm font-medium text-foreground"
                htmlFor="task-type"
              >
                {t("tasks.fields.type")}
              </label>
              <Select
                id="task-type"
                ariaLabel={t("tasks.fields.type")}
                value={selectedType}
                onValueChange={(value) =>
                  setSelectedType(value as WorkItemType)
                }
                disabled={mode === "edit"}
                className="min-w-36"
                options={[
                  {
                    value: WORK_ITEM_TYPE.TASK,
                    label: t("tasks.type.task"),
                  },
                  {
                    value: WORK_ITEM_TYPE.EPIC,
                    label: t("tasks.type.epic"),
                  },
                  {
                    value: WORK_ITEM_TYPE.INITIATIVE,
                    label: t("tasks.type.initiative"),
                  },
                  {
                    value: WORK_ITEM_TYPE.SUBTASK,
                    label: t("tasks.type.subtask"),
                  },
                ]}
              />
            </div>

            <div>
              <label
                className="block select-none text-sm font-medium text-foreground"
                htmlFor="task-project"
              >
                {t("tasks.fields.project")}
              </label>
              <Select
                id="task-project"
                ariaLabel={t("tasks.fields.project")}
                value={selectedProjectId}
                onValueChange={setSelectedProjectId}
                disabled={mode === "edit"}
                className="min-w-36"
                options={projects.map((project) => ({
                  value: project.id,
                  label: project.name,
                }))}
              />
            </div>
          </div>

          {selectedType === WORK_ITEM_TYPE.EPIC ? (
            <div>
              <label
                className="block select-none text-sm font-medium text-foreground"
                htmlFor="task-parent-initiative"
              >
                {t("tasks.fields.parentInitiative")}
              </label>
              <Select
                id="task-parent-initiative"
                ariaLabel={t("tasks.fields.parentInitiative")}
                value={selectedParentId}
                onValueChange={setSelectedParentId}
                className="min-w-36"
                options={[
                  { value: "", label: t("tasks.none") },
                  ...availableInitiatives.map((initiative) => ({
                    value: initiative.id,
                    label: `${initiative.key}: ${initiative.title}`,
                  })),
                ]}
              />
            </div>
          ) : null}

          {selectedType === WORK_ITEM_TYPE.TASK ? (
            <div>
              <label
                className="block select-none text-sm font-medium text-foreground"
                htmlFor="task-parent-epic"
              >
                {t("tasks.fields.parentEpic")}
              </label>
              <Select
                id="task-parent-epic"
                ariaLabel={t("tasks.fields.parentEpic")}
                value={selectedParentId}
                onValueChange={setSelectedParentId}
                className="min-w-36"
                options={[
                  { value: "", label: t("tasks.none") },
                  ...availableEpics.map((epic) => ({
                    value: epic.id,
                    label: `${epic.key}: ${epic.title}`,
                  })),
                ]}
              />
            </div>
          ) : null}

          {selectedType === WORK_ITEM_TYPE.SUBTASK ? (
            <div>
              <label
                className="block select-none text-sm font-medium text-foreground"
                htmlFor="task-parent-task"
              >
                {t("tasks.fields.parentTask")}
              </label>
              <Select
                id="task-parent-task"
                ariaLabel={t("tasks.fields.parentTask")}
                value={selectedParentId}
                onValueChange={setSelectedParentId}
                className="min-w-36"
                options={[
                  { value: "", label: t("tasks.none") },
                  ...availableTasks.map((task) => ({
                    value: task.id,
                    label: `${task.key}: ${task.title}`,
                  })),
                ]}
              />
            </div>
          ) : null}

          <div>
            <label
              className="block select-none text-sm font-medium text-foreground"
              htmlFor="task-title"
            >
              {t("tasks.fields.title")}
            </label>
            <Input
              className="mt-1"
              defaultValue={initialTask?.title ?? ""}
              id="task-title"
              maxLength={200}
              name="title"
              required
            />
          </div>

          <div>
            <label
              className="block select-none text-sm font-medium text-foreground"
              htmlFor="task-description"
            >
              {t("tasks.fields.description")}
            </label>
            <Textarea
              className="mt-1 resize-y"
              defaultValue={initialTask?.description ?? ""}
              id="task-description"
              maxLength={10000}
              name="description"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label
                className="block select-none text-sm font-medium text-foreground"
                htmlFor="task-status"
              >
                {t("tasks.fields.status")}
              </label>
              <Select
                id="task-status"
                ariaLabel={t("tasks.fields.status")}
                value={selectedStatusId}
                onValueChange={setSelectedStatusId}
                className="min-w-36"
                options={statuses.map((status) => ({
                  value: status.id,
                  label: status.name,
                }))}
              />
            </div>

            <div>
              <label
                className="block select-none text-sm font-medium text-foreground"
                htmlFor="task-priority"
              >
                {t("tasks.fields.priority")}
              </label>
              <Select
                id="task-priority"
                ariaLabel={t("tasks.fields.priority")}
                value={selectedPriority}
                onValueChange={(value) =>
                  setSelectedPriority(value as WorkItemPriority)
                }
                className="min-w-36"
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
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label
                className="block select-none text-sm font-medium text-foreground"
                htmlFor="task-assignee"
              >
                {t("tasks.fields.assignee")}
              </label>
              <Select
                id="task-assignee"
                ariaLabel={t("tasks.fields.assignee")}
                value={selectedAssigneeId}
                onValueChange={setSelectedAssigneeId}
                className="min-w-36"
                options={[
                  { value: "", label: t("tasks.unassigned") },
                  ...assignees.map((assignee) => ({
                    value: assignee.id,
                    label: assignee.displayName,
                  })),
                ]}
              />
            </div>

            <div>
              <label
                className="block select-none text-sm font-medium text-foreground"
                htmlFor="task-milestone"
              >
                {t("tasks.fields.milestone")}
              </label>
              <Select
                id="task-milestone"
                ariaLabel={t("tasks.fields.milestone")}
                value={selectedMilestoneId}
                onValueChange={setSelectedMilestoneId}
                className="min-w-36"
                options={[
                  { value: "", label: t("tasks.none") },
                  ...availableMilestones.map((milestone) => ({
                    value: milestone.id,
                    label: milestone.name,
                  })),
                ]}
              />
            </div>
          </div>

          <div>
            <label
              className="block select-none text-sm font-medium text-foreground"
              htmlFor="task-due-at"
            >
              {t("tasks.fields.dueAt")}
            </label>
            <Input
              className="mt-1"
              defaultValue={initialTask?.dueAt ?? ""}
              id="task-due-at"
              name="dueAt"
              type="date"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {mode === "edit" && initialTask ? (
              <div>
                <label
                  className="block select-none text-sm font-medium text-foreground"
                  htmlFor="task-reporter"
                >
                  {t("tasks.fields.reporter")}
                </label>
                <Select
                  id="task-reporter"
                  ariaLabel={t("tasks.fields.reporter")}
                  value={selectedReporterId}
                  onValueChange={setSelectedReporterId}
                  className="min-w-36"
                  options={reporterOptions(initialTask, assignees)}
                />
              </div>
            ) : null}

            <div>
              <label
                className="block select-none text-sm font-medium text-foreground"
                htmlFor="task-start-at"
              >
                {t("tasks.fields.startAt")}
              </label>
              <Input
                className="mt-1"
                defaultValue={initialTask?.startAt ?? ""}
                id="task-start-at"
                name="startAt"
                type="date"
              />
            </div>
          </div>

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {t(`tasks.error.${error}`, { defaultValue: error })}
            </p>
          ) : null}

          <div className="mt-2 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">{t("tasks.actions.cancel")}</Button>
            </DialogClose>
            <Button disabled={isSubmitting} type="submit">
              {isSubmitting
                ? mode === "create"
                  ? t("tasks.create.submitting")
                  : t("tasks.edit.submitting")
                : mode === "create"
                  ? t("tasks.create.submit")
                  : t("tasks.edit.submit")}
            </Button>
          </div>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
