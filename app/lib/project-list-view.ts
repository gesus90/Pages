import { PROJECT_STATUS } from "@/definition/Project";

import type { Project, ProjectStatus } from "@/definition/Project";

/** Sort orders supported by the project overview dropdown. */
export const PROJECT_SORT_FIELDS = [
  "updatedDesc",
  "updatedAsc",
  "nameAsc",
  "nameDesc",
  "statusAsc",
  "statusDesc",
] as const;

/** A sort order selectable on the project overview. */
export type ProjectSortField = (typeof PROJECT_SORT_FIELDS)[number];

/** The status filters of the project overview; completed projects have none. */
export const PROJECT_STATUS_FILTERS = [
  "all",
  PROJECT_STATUS.PLANNED,
  PROJECT_STATUS.ACTIVE,
  PROJECT_STATUS.PAUSED,
] as const;

/** Lets every project through (`"all"`) or only those with one status. */
export type ProjectStatusFilter = "all" | ProjectStatus;

/** What the visitor chose to see on the project overview. */
export interface ProjectListView {
  readonly filter: ProjectStatusFilter;
  readonly search: string;
  readonly sortField: ProjectSortField;
}

/**
 * Status rank used for status sorting.
 *
 * @remarks
 * Active projects come first and completed projects last so the most
 * relevant work stays on top; the reversed order flips this ranking.
 */
const STATUS_WEIGHT: Record<ProjectStatus, number> = {
  active: 0,
  planned: 1,
  paused: 2,
  completed: 3,
};

const PROJECT_SORT_COMPARISONS: Record<
  ProjectSortField,
  (first: Project, second: Project) => number
> = {
  updatedDesc: (first, second) =>
    second.updatedAt.localeCompare(first.updatedAt),
  updatedAsc: (first, second) =>
    first.updatedAt.localeCompare(second.updatedAt),
  nameAsc: (first, second) => first.name.localeCompare(second.name),
  nameDesc: (first, second) => second.name.localeCompare(first.name),
  statusAsc: (first, second) =>
    STATUS_WEIGHT[first.status] - STATUS_WEIGHT[second.status],
  statusDesc: (first, second) =>
    STATUS_WEIGHT[second.status] - STATUS_WEIGHT[first.status],
};

/** Narrows an unknown select value to a supported project sort order. */
export function isProjectSortField(value: string): value is ProjectSortField {
  return PROJECT_SORT_FIELDS.some((field) => field === value);
}

function matchesFilter(project: Project, filter: ProjectStatusFilter): boolean {
  return filter === "all" || project.status === filter;
}

function matchesSearch(project: Project, query: string): boolean {
  return (
    !query ||
    project.name.toLocaleLowerCase().includes(query) ||
    project.description.toLocaleLowerCase().includes(query)
  );
}

/**
 * Selects and orders the projects the overview shows.
 *
 * @param projects - All projects the visitor may see.
 * @param view - The status filter, the search text and the sort order.
 * @returns A new list; the given projects stay untouched.
 */
export function listVisibleProjects(
  projects: readonly Project[],
  view: ProjectListView,
): Project[] {
  const query = view.search.trim().toLocaleLowerCase();

  return projects
    .filter(
      (project) =>
        matchesFilter(project, view.filter) && matchesSearch(project, query),
    )
    .sort(PROJECT_SORT_COMPARISONS[view.sortField]);
}
