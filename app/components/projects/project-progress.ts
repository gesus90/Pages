import type { Milestone, WorkItemDetail } from "@/definition/Task";

/** Minimal work item shape required for progress aggregation. */
export type ProgressWorkItem = Pick<
  WorkItemDetail,
  "isDone" | "milestoneId" | "type"
>;

/** Aggregated completion numbers for a set of work items. */
export interface TaskCompletion {
  readonly total: number;
  readonly done: number;
  readonly percentage: number;
}

/**
 * Computes completion numbers for the given work items.
 *
 * @param workItems - Work items to aggregate.
 * @returns Total, completed, and percentage values.
 */
export function getTaskCompletion(
  workItems: readonly ProgressWorkItem[],
): TaskCompletion {
  const total = workItems.length;
  const done = workItems.filter((item) => item.isDone).length;

  return {
    done,
    percentage: total === 0 ? 0 : Math.round((done / total) * 100),
    total,
  };
}

/**
 * Computes milestone progress from its assigned tasks.
 *
 * @param milestoneId - Milestone grouping the tasks.
 * @param workItems - All work items of the project.
 * @returns Total, completed, and percentage values.
 */
export function getMilestoneProgress(
  milestoneId: string,
  workItems: readonly ProgressWorkItem[],
): TaskCompletion {
  return getTaskCompletion(
    workItems.filter((item) => item.milestoneId === milestoneId),
  );
}

/**
 * Counts completed milestones.
 *
 * @param milestones - Milestones of the project.
 * @returns Number of completed milestones and the total.
 */
export function getMilestoneCompletion(
  milestones: readonly Milestone[],
): TaskCompletion {
  const total = milestones.length;
  const done = milestones.filter(
    (milestone) => milestone.status === "completed",
  ).length;

  return {
    done,
    percentage: total === 0 ? 0 : Math.round((done / total) * 100),
    total,
  };
}

/**
 * Counts open subtasks across the project.
 *
 * @param workItems - All work items of the project.
 * @returns Number of non-completed subtasks.
 */
export function countOpenSubtasks(
  workItems: readonly ProgressWorkItem[],
): number {
  return workItems.filter((item) => item.type === "subtask" && !item.isDone)
    .length;
}
