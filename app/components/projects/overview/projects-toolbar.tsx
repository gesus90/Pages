import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { HorizontalScrollArea } from "@/app/components/ui/horizontal-scroll-area";
import { Input } from "@/app/components/ui/input";
import { SegmentedControl } from "@/app/components/ui/segmented-control";
import { Select } from "@/app/components/ui/select";
import {
  PROJECT_SORT_FIELDS,
  PROJECT_STATUS_FILTERS,
} from "@/app/lib/project-list-view";

import type {
  ProjectSortField,
  ProjectStatusFilter,
} from "@/app/lib/project-list-view";
import type { Department } from "@/definition/Authorization";

interface ProjectStatusFiltersProps {
  readonly filter: ProjectStatusFilter;
  readonly onFilterChange: (filter: ProjectStatusFilter) => void;
}

interface ProjectSearchFieldProps {
  readonly search: string;
  readonly onSearchChange: (search: string) => void;
}

interface ProjectSortSelectProps {
  readonly sortField: ProjectSortField;
  readonly onSortChange: (sortField: ProjectSortField) => void;
}

interface ProjectDepartmentFilterProps {
  readonly departments: readonly Department[];
  readonly departmentId: string;
  readonly onDepartmentChange: (departmentId: string) => void;
}

interface ProjectsToolbarProps
  extends
    ProjectStatusFiltersProps,
    ProjectSearchFieldProps,
    ProjectSortSelectProps,
    ProjectDepartmentFilterProps {}

function ProjectStatusFilters({
  filter,
  onFilterChange,
}: ProjectStatusFiltersProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <HorizontalScrollArea
      className="max-w-full"
      contentClassName="w-max pr-10 pb-2"
    >
      <SegmentedControl
        ariaLabel={t("projects.filters.label")}
        value={filter}
        onValueChange={onFilterChange}
        options={PROJECT_STATUS_FILTERS.map((status) => ({
          value: status,
          label: t(`projects.filters.${status}`),
        }))}
      />
    </HorizontalScrollArea>
  );
}

function ProjectSearchField({
  search,
  onSearchChange,
}: ProjectSearchFieldProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="relative h-9 min-w-52 flex-1 sm:max-w-80">
      <Search
        className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        size="sm"
        className="pl-10 xl:pl-10"
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        aria-label={t("projects.searchLabel")}
        placeholder={t("projects.search")}
      />
    </div>
  );
}

function ProjectSortSelect({
  sortField,
  onSortChange,
}: ProjectSortSelectProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <Select
      ariaLabel={t("projects.sort.label")}
      className="w-full sm:w-56"
      value={sortField}
      onValueChange={onSortChange}
      options={PROJECT_SORT_FIELDS.map((field) => ({
        value: field,
        label: t(`projects.sort.${field}`),
      }))}
    />
  );
}

function ProjectDepartmentFilter({
  departments,
  departmentId,
  onDepartmentChange,
}: ProjectDepartmentFilterProps): React.ReactElement | null {
  const { t } = useTranslation();
  if (departments.length === 0) return null;
  return (
    <Select
      ariaLabel={t("projects.departments.filterLabel")}
      className="w-full sm:w-48"
      value={departmentId}
      onValueChange={onDepartmentChange}
      options={[
        { value: "", label: t("projects.departments.all") },
        ...departments.map((department) => ({
          value: department.id,
          label: department.name,
        })),
      ]}
    />
  );
}

/** Renders accessible project status, department, search and sort controls. */
export function ProjectsToolbar(
  properties: ProjectsToolbarProps,
): React.ReactElement {
  return (
    <div className="mt-7 flex shrink-0 flex-wrap items-center gap-2.5">
      <ProjectStatusFilters
        filter={properties.filter}
        onFilterChange={properties.onFilterChange}
      />
      <ProjectSearchField
        search={properties.search}
        onSearchChange={properties.onSearchChange}
      />
      <ProjectDepartmentFilter
        departments={properties.departments}
        departmentId={properties.departmentId}
        onDepartmentChange={properties.onDepartmentChange}
      />
      <ProjectSortSelect
        sortField={properties.sortField}
        onSortChange={properties.onSortChange}
      />
    </div>
  );
}
