import type {
  BoardSortDirection,
  BoardSortField,
} from "@/definition/BoardPreferences";
import type { WorkItemDetail, WorkItemPriority } from "@/definition/Task";

/** Orders the task list and the kanban columns can take. */
export type TaskSortField = BoardSortField;

/** Direction a sorted task list runs in. */
export type TaskSortDirection = BoardSortDirection;

const PRIORITY_WEIGHT: Record<WorkItemPriority, number> = {
  urgent: 4,
  high: 3,
  normal: 2,
  low: 1,
};

/**
 * Normalizes optional due dates for lexicographic sorting.
 *
 * @param value - Due date or `null` for unscheduled items.
 * @returns The date, or an empty string sorting before any real date.
 */
function toSortableDueAt(value: string | null): string {
  if (value === null) {
    return "";
  }

  return value;
}

const SORT_COMPARISONS: Record<
  TaskSortField,
  (first: WorkItemDetail, second: WorkItemDetail) => number
> = {
  manual: (first, second) => first.sortOrder - second.sortOrder,
  updated: (first, second) => first.updatedAt.localeCompare(second.updatedAt),
  priority: (first, second) =>
    PRIORITY_WEIGHT[first.priority] - PRIORITY_WEIGHT[second.priority],
  dueDate: (first, second) =>
    toSortableDueAt(first.dueAt).localeCompare(toSortableDueAt(second.dueAt)),
  project: (first, second) =>
    first.projectName.localeCompare(second.projectName),
  status: (first, second) => first.statusName.localeCompare(second.statusName),
  title: (first, second) => first.title.localeCompare(second.title),
};

/**
 * Orders work items by one column.
 *
 * @param workItems - Items to order; the array itself stays untouched.
 * @param sortField - Column whose values are compared.
 * @param sortDirection - `asc` keeps the comparison order, `desc` reverses it.
 * @returns A new, sorted array.
 */
export function sortWorkItems(
  workItems: readonly WorkItemDetail[],
  sortField: TaskSortField,
  sortDirection: TaskSortDirection,
): WorkItemDetail[] {
  return [...workItems].sort((first, second) => {
    const comparison = SORT_COMPARISONS[sortField](first, second);

    return sortDirection === "asc" ? comparison : -comparison;
  });
}
