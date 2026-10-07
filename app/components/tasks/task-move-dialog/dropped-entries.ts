import type { Milestone, Label, WorkItemDetail } from "@/definition/Task";
import type { User } from "@/definition/User";

/** What decides which relations of a ticket survive a move. */
export interface DroppedEntriesInput {
  readonly task: WorkItemDetail;
  readonly targetProjectId: string;
  readonly workItems: readonly WorkItemDetail[];
  readonly milestones: readonly Milestone[];
  readonly taskLabels: readonly Label[];
  readonly assigneesByProject: Readonly<Record<string, readonly User[]>>;
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

/**
 * Lists the project-bound relations a ticket loses when it moves.
 *
 * @remarks
 * Labels always belong to their project and are dropped; the parent, the
 * milestone and the assignee stay when the target project has them too, and
 * the linked GitHub issue never moves along.
 *
 * @returns Readable names in the order parent, milestone, labels, GitHub
 * issue and assignee.
 */
export function getDroppedEntries(input: DroppedEntriesInput): string[] {
  const entries = [
    getDroppedParent(input),
    getDroppedMilestone(input),
    ...input.taskLabels.map((label) => label.name),
    getDroppedGithubIssue(input),
    getDroppedAssignee(input),
  ];

  return entries.filter((entry): entry is string => entry !== null);
}
