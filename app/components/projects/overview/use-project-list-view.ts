import { useState } from "react";

import { listVisibleProjects } from "@/app/lib/project-list-view";

import type {
  ProjectSortField,
  ProjectStatusFilter,
} from "@/app/lib/project-list-view";
import type { Project } from "@/definition/Project";

/** The choices of the visitor and the projects they select. */
export interface ProjectListViewState {
  readonly filter: ProjectStatusFilter;
  readonly search: string;
  readonly sortField: ProjectSortField;
  readonly visibleProjects: readonly Project[];
  readonly setFilter: (filter: ProjectStatusFilter) => void;
  readonly setSearch: (search: string) => void;
  readonly setSortField: (sortField: ProjectSortField) => void;
}

/**
 * Keeps the status filter, the search text and the sort order of the overview.
 *
 * @param projects - All projects the visitor may see.
 */
export function useProjectListView(
  projects: readonly Project[],
): ProjectListViewState {
  const [filter, setFilter] = useState<ProjectStatusFilter>("all");
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<ProjectSortField>("updatedDesc");
  const visibleProjects = listVisibleProjects(projects, {
    filter,
    search,
    sortField,
  });

  return {
    filter,
    search,
    setFilter,
    setSearch,
    setSortField,
    sortField,
    visibleProjects,
  };
}
