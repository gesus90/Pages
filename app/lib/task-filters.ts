import type { WorkItemDetail } from "@/definition/Task";

/** The value of a filter select that lets everything through. */
export const FILTER_ALL = "all";

/** What the task views are filtered by. */
export interface TaskFilters {
  readonly scope: "mine" | "all";
  readonly project: string;
  readonly type: string;
  readonly status: string;
  readonly priority: string;
  readonly milestone: string;
  readonly search: string;
}

/** The filters before the visitor chose anything: their own tasks, unfiltered. */
export const DEFAULT_TASK_FILTERS: TaskFilters = {
  milestone: FILTER_ALL,
  priority: FILTER_ALL,
  project: FILTER_ALL,
  scope: "mine",
  search: "",
  status: FILTER_ALL,
  type: FILTER_ALL,
};

function matchesSearch(item: WorkItemDetail, search: string): boolean {
  const query = search.trim().toLowerCase();

  return (
    query === "" ||
    item.title.toLowerCase().includes(query) ||
    item.key.toLowerCase().includes(query)
  );
}

/**
 * Keeps the work items that pass every filter.
 *
 * @param items - All work items the visitor may see.
 * @param filters - What the visitor chose.
 * @param actorId - The visitor, for the filter that shows only their tasks.
 */
export function filterWorkItems(
  items: readonly WorkItemDetail[],
  filters: TaskFilters,
  actorId: string,
): WorkItemDetail[] {
  const passes = (selected: string, value: string | null): boolean =>
    selected === FILTER_ALL || value === selected;

  return items.filter(
    (item) =>
      (filters.scope !== "mine" || item.assigneeId === actorId) &&
      passes(filters.project, item.projectId) &&
      passes(filters.type, item.type) &&
      passes(filters.status, item.statusId) &&
      passes(filters.priority, item.priority) &&
      passes(filters.milestone, item.milestoneId) &&
      matchesSearch(item, filters.search),
  );
}
