import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useActionData, useSubmit } from "react-router";

import { Button } from "@/app/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/app/components/ui/dialog";
import { Select } from "@/app/components/ui/select";
import { taskUpdateSnapshot } from "@/definition/TaskUpdateSnapshot";

import type { Project } from "@/definition/Project";
import type { Label, Milestone, WorkItemDetail } from "@/definition/Task";
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

interface DroppedEntriesInput {
  readonly task: WorkItemDetail;
  readonly targetProjectId: string;
  readonly workItems: readonly WorkItemDetail[];
  readonly milestones: readonly Milestone[];
  readonly taskLabels: readonly Label[];
  readonly assigneesByProject: Readonly<Record<string, readonly User[]>>;
}

interface MoveTargetSelectProps {
  readonly projects: readonly Project[];
  readonly currentProjectId: string;
  readonly value: string;
  readonly onChange: (projectId: string) => void;
}

interface MoveSummaryProps {
  readonly sourceName: string;
  readonly targetName: string;
  readonly droppedEntries: readonly string[];
}

function getDroppedParent({
  task,
  targetProjectId,
  workItems,
}: DroppedEntriesInput): string | null {
  if (task.parentId === null || task.parentKey === null) {
    return null;
  }

  const parent = workItems.find((item) => item.id === task.parentId);

  if (parent?.projectId === targetProjectId) {
    return null;
  }

  return `${task.parentKey} ${task.parentTitle ?? ""}`.trim();
}

function getDroppedMilestone({
  task,
  targetProjectId,
  milestones,
}: DroppedEntriesInput): string | null {
  const milestone = milestones.find(
    (candidate) => candidate.id === task.milestoneId,
  );

  if (milestone === undefined || milestone.projectId === targetProjectId) {
    return null;
  }

  return milestone.name;
}

function getDroppedGithubIssue({ task }: DroppedEntriesInput): string | null {
  if (task.githubIssueNumber === null) {
    return null;
  }

  return `#${task.githubIssueNumber}`;
}

function getDroppedAssignee({
  task,
  targetProjectId,
  assigneesByProject,
}: DroppedEntriesInput): string | null {
  if (task.assigneeId === null || task.assigneeName === null) {
    return null;
  }

  const targetAssignees = assigneesByProject[targetProjectId] ?? [];
  const isAssigneeKept = targetAssignees.some(
    (user) => user.id === task.assigneeId,
  );

  return isAssigneeKept ? null : task.assigneeName;
}

function getDroppedEntries(input: DroppedEntriesInput): string[] {
  const entries = [
    getDroppedParent(input),
    getDroppedMilestone(input),
    ...input.taskLabels.map((label) => label.name),
    getDroppedGithubIssue(input),
    getDroppedAssignee(input),
  ];

  return entries.filter((entry): entry is string => entry !== null);
}

function MoveTargetSelect({
  projects,
  currentProjectId,
  value,
  onChange,
}: MoveTargetSelectProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="mt-4">
      <span
        className="block select-none text-sm font-medium text-foreground"
        id="task-move-target"
      >
        {t("tasks.move.target")}
      </span>
      <Select
        ariaLabel={t("tasks.move.target")}
        value={value}
        onValueChange={onChange}
        className="mt-1 w-full"
        options={[
          { value: "", label: t("tasks.move.choose") },
          ...projects
            .filter((project) => project.id !== currentProjectId)
            .map((project) => ({
              value: project.id,
              label: project.name,
            })),
        ]}
      />
    </div>
  );
}

function MoveSummary({
  sourceName,
  targetName,
  droppedEntries,
}: MoveSummaryProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="mt-4 rounded-xl bg-muted/40 p-4 text-sm">
      <p className="font-semibold text-foreground">
        {sourceName} → {targetName}
      </p>
      {droppedEntries.length > 0 ? (
        <div className="mt-2">
          <p className="text-muted-foreground">{t("tasks.move.droppedHint")}</p>
          <ul className="mt-1 list-disc pl-5 text-foreground">
            {droppedEntries.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-2 text-muted-foreground">{t("tasks.move.keepsAll")}</p>
      )}
    </div>
  );
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
