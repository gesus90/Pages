import {
  BOARD_FILTER_ALL,
  BOARD_FILTER_NONE,
} from "@/definition/BoardPreferences";

import type { BoardPreferences } from "@/definition/BoardPreferences";
import type { Label, WorkItemDetail } from "@/definition/Task";

/** The value of a filter select that lets everything through. */
export const FILTER_ALL = BOARD_FILTER_ALL;

/** What the task views are filtered by. */
export type TaskFilters = Pick<
  BoardPreferences,
  | "scope"
  | "project"
  | "type"
  | "status"
  | "priority"
  | "milestone"
  | "assignee"
  | "department"
  | "labelIds"
  | "search"
>;

/** The person looking at the board, with the groups they belong to. */
export interface TaskViewer {
  readonly actorId: string;
  readonly memberGroupIds: readonly string[];
  /** The labels of every ticket, needed by the label filter. */
  readonly labelsByWorkItem?: Readonly<Record<string, readonly Label[]>>;
}

const WORK_TYPES: readonly string[] = ["task", "subtask"];

function isAssignedTo(item: WorkItemDetail, viewer: TaskViewer): boolean {
  return (
    item.assigneeId === viewer.actorId ||
    (item.assigneeGroupId !== null &&
      viewer.memberGroupIds.includes(item.assigneeGroupId))
  );
}

function matchesSearch(item: WorkItemDetail, search: string): boolean {
  const query = search.trim().toLowerCase();

  return (
    query === "" ||
    item.title.toLowerCase().includes(query) ||
    item.key.toLowerCase().includes(query)
  );
}

function matchesType(item: WorkItemDetail, type: string): boolean {
  if (type === "work") {
    return WORK_TYPES.includes(item.type);
  }

  return type === FILTER_ALL || item.type === type;
}

function matchesAssignee(item: WorkItemDetail, assignee: string): boolean {
  if (assignee === FILTER_ALL) {
    return true;
  }

  if (assignee === BOARD_FILTER_NONE) {
    return item.assigneeId === null && item.assigneeGroupId === null;
  }

  return assignee.startsWith("group:")
    ? item.assigneeGroupId === assignee.slice("group:".length)
    : item.assigneeId === assignee;
}

function matchesDepartment(item: WorkItemDetail, department: string): boolean {
  if (department === BOARD_FILTER_NONE) {
    return item.departmentId === null;
  }

  return department === FILTER_ALL || item.departmentId === department;
}

function matchesLabels(
  item: WorkItemDetail,
  viewer: TaskViewer,
  labelIds: readonly string[],
): boolean {
  if (labelIds.length === 0) {
    return true;
  }

  const assigned = viewer.labelsByWorkItem?.[item.id] ?? [];

  return assigned.some((label) => labelIds.includes(label.id));
}

/**
 * Lets the hierarchy view show initiatives and epics without a type filter.
 *
 * @param preferences - What the visitor chose.
 * @returns The filters to apply: the default type filter of tasks and subtasks
 * is lifted in the hierarchy view, which is about the levels above them.
 */
export function toTaskFilters(preferences: BoardPreferences): TaskFilters {
  return preferences.view === "hierarchy" && preferences.type === "work"
    ? { ...preferences, type: "all" }
    : preferences;
}

/**
 * Keeps the work items that pass every filter.
 *
 * @param items - All work items the visitor may see.
 * @param filters - What the visitor chose.
 * @param viewer - The visitor and their groups, for the filter that shows only
 * their tasks: assigned to them or to one of their groups; also the labels of
 * the tickets for the label filter.
 */
export function filterWorkItems(
  items: readonly WorkItemDetail[],
  filters: TaskFilters,
  viewer: TaskViewer,
): WorkItemDetail[] {
  const passes = (selected: string, value: string | null): boolean =>
    selected === FILTER_ALL || value === selected;

  return items.filter(
    (item) =>
      (filters.scope !== "mine" || isAssignedTo(item, viewer)) &&
      passes(filters.project, item.projectId) &&
      matchesType(item, filters.type) &&
      passes(filters.status, item.statusId) &&
      passes(filters.priority, item.priority) &&
      passes(filters.milestone, item.milestoneId) &&
      matchesAssignee(item, filters.assignee) &&
      matchesDepartment(item, filters.department) &&
      matchesLabels(item, viewer, filters.labelIds) &&
      matchesSearch(item, filters.search),
  );
}
