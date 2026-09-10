import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSubmit } from "react-router";

import { Button } from "@/app/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/app/components/ui/dialog";
import { Select } from "@/app/components/ui/select";

import type { Project } from "@/definition/Project";
import type {
  Milestone,
  ProjectLabel,
  WorkItemDetail,
} from "@/definition/Task";
import type { User } from "@/definition/User";

interface TaskMoveDialogProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly task: WorkItemDetail;
  readonly projects: readonly Project[];
  readonly workItems: readonly WorkItemDetail[];
  readonly milestones: readonly Milestone[];
  readonly taskLabels: readonly ProjectLabel[];
  readonly assigneesByProject: Readonly<Record<string, readonly User[]>>;
  readonly initialTargetProjectId?: string;
  readonly isSubmitting?: boolean;
}

/** Confirms moving a ticket, listing project-bound relations that are dropped. */
export function TaskMoveDialog({
  isOpen,
  onOpenChange,
  task,
  projects,
  workItems,
  milestones,
  taskLabels,
  assigneesByProject,
  initialTargetProjectId = "",
  isSubmitting = false,
}: TaskMoveDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const submit = useSubmit();
  const [targetProjectId, setTargetProjectId] = useState<string>(
    initialTargetProjectId,
  );

  const targetProject = projects.find(
    (project) => project.id === targetProjectId,
  );
  const sourceProject = projects.find(
    (project) => project.id === task.projectId,
  );
  const parent = workItems.find((item) => item.id === task.parentId);
  const parentKept =
    task.parentId === null || parent?.projectId === targetProjectId;
  const milestone = milestones.find(
    (candidate) => candidate.id === task.milestoneId,
  );
  const targetAssignees = assigneesByProject[targetProjectId] ?? [];
  const assigneeKept =
    task.assigneeId === null ||
    targetAssignees.some((user) => user.id === task.assigneeId);

  const droppedEntries: string[] = [];

  if (targetProject !== undefined && task.parentKey !== null && !parentKept) {
    droppedEntries.push(`${task.parentKey} ${task.parentTitle ?? ""}`.trim());
  }

  if (
    targetProject !== undefined &&
    milestone !== undefined &&
    milestone.projectId !== targetProjectId
  ) {
    droppedEntries.push(milestone.name);
  }

  if (targetProject !== undefined) {
    for (const label of taskLabels) {
      droppedEntries.push(label.name);
    }

    if (task.githubIssueNumber !== null) {
      droppedEntries.push(`#${task.githubIssueNumber}`);
    }

    if (!assigneeKept && task.assigneeName !== null) {
      droppedEntries.push(task.assigneeName);
    }
  }

  function handleMove(): void {
    submit(
      { id: task.id, intent: "move-project", targetProjectId },
      { method: "post" },
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[min(30rem,94vw)] overflow-y-auto">
        <DialogTitle className="select-none text-lg font-semibold text-foreground">
          {t("tasks.move.title")}
        </DialogTitle>

        <div className="mt-4">
          <span
            className="block select-none text-sm font-medium text-foreground"
            id="task-move-target"
          >
            {t("tasks.move.target")}
          </span>
          <Select
            ariaLabel={t("tasks.move.target")}
            value={targetProjectId}
            onValueChange={setTargetProjectId}
            className="mt-1 w-full"
            options={[
              { value: "", label: t("tasks.move.choose") },
              ...projects
                .filter((project) => project.id !== task.projectId)
                .map((project) => ({
                  value: project.id,
                  label: project.name,
                })),
            ]}
          />
        </div>

        {targetProject ? (
          <div className="mt-4 rounded-xl bg-muted/40 p-4 text-sm">
            <p className="font-semibold text-foreground">
              {sourceProject?.name ?? task.projectName} → {targetProject.name}
            </p>
            {droppedEntries.length > 0 ? (
              <div className="mt-2">
                <p className="text-muted-foreground">
                  {t("tasks.move.droppedHint")}
                </p>
                <ul className="mt-1 list-disc pl-5 text-foreground">
                  {droppedEntries.map((entry) => (
                    <li key={entry}>{entry}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="mt-2 text-muted-foreground">
                {t("tasks.move.keepsAll")}
              </p>
            )}
          </div>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <Button
            onClick={() => onOpenChange(false)}
            type="button"
            variant="ghost"
          >
            {t("tasks.actions.cancel")}
          </Button>
          <Button
            disabled={isSubmitting || !targetProject}
            onClick={handleMove}
            type="button"
          >
            {t("tasks.move.submit")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
