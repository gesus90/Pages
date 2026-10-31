import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useActionData, useSubmit } from "react-router";

import { getDroppedEntries } from "@/app/components/tasks/task-move-dialog/dropped-entries";
import { MoveSummary } from "@/app/components/tasks/task-move-dialog/move-summary";
import { MoveTargetSelect } from "@/app/components/tasks/task-move-dialog/move-target-select";
import { Button } from "@/app/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/app/components/ui/dialog";
import { taskUpdateSnapshot } from "@/definition/TaskUpdateSnapshot";

import type { Project } from "@/definition/Project";
import type { Milestone, Label, WorkItemDetail } from "@/definition/Task";
import type { User } from "@/definition/User";

interface TaskMoveDialogProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly task: WorkItemDetail;
  readonly projects: readonly Project[];
  readonly workItems: readonly WorkItemDetail[];
  readonly milestones: readonly Milestone[];
  readonly taskLabels: readonly Label[];
  readonly assigneesByProject: Readonly<Record<string, readonly User[]>>;
  readonly initialTargetProjectId?: string;
  readonly isSubmitting?: boolean;
}

interface MoveOutcome {
  readonly ok: boolean;
  readonly intent?: string;
  readonly error?: string;
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
  const outcome = useActionData<MoveOutcome | undefined>();
  const failure =
    outcome && !outcome.ok && outcome.intent === "move-project"
      ? outcome.error
      : undefined;
  const [targetProjectId, setTargetProjectId] = useState<string>(
    initialTargetProjectId,
  );

  const targetProject = projects.find(
    (project) => project.id === targetProjectId,
  );
  const sourceProject = projects.find(
    (project) => project.id === task.projectId,
  );

  function handleMove(): void {
    void submit(
      {
        baseProjectId: task.projectId,
        baseGithubIssueNumber: task.githubIssueNumber?.toString() ?? "",
        boardLocal: "true",
        expectedSnapshot: JSON.stringify(taskUpdateSnapshot(task)),
        id: task.id,
        intent: "move-project",
        targetProjectId,
      },
      { method: "post" },
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[min(30rem,94vw)] overflow-y-auto">
        <DialogTitle className="select-none text-lg font-semibold text-foreground">
          {t("tasks.move.title")}
        </DialogTitle>

        {failure ? (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {t(`tasks.error.${failure}`)}
          </p>
        ) : null}

        <MoveTargetSelect
          currentProjectId={task.projectId}
          onChange={setTargetProjectId}
          projects={projects}
          value={targetProjectId}
        />

        {targetProject ? (
          <MoveSummary
            droppedEntries={getDroppedEntries({
              assigneesByProject,
              milestones,
              targetProjectId,
              task,
              taskLabels,
              workItems,
            })}
            sourceName={sourceProject?.name ?? task.projectName}
            targetName={targetProject.name}
          />
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
