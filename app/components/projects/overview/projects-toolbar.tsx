import { ChevronDown, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import {
  PROJECT_SORT_FIELDS,
  PROJECT_STATUS_FILTERS,
  isProjectSortField,
} from "@/app/lib/project-list-view";

import type {
  ProjectSortField,
  ProjectStatusFilter,
} from "@/app/lib/project-list-view";
import type { ChangeEvent } from "react";

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

interface ProjectsToolbarProps
  extends
    ProjectStatusFiltersProps,
    ProjectSearchFieldProps,
    ProjectSortSelectProps {}

function ProjectStatusFilters({
  filter,
  onFilterChange,
}: ProjectStatusFiltersProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap items-center gap-1">
      {PROJECT_STATUS_FILTERS.map((status) => (
        <Button
          key={status}
          className={
            filter === status
              ? "bg-primary-subtle text-primary-hover shadow-xs hover:bg-primary-subtle"
              : "text-muted-foreground"
          }
          onClick={() => onFilterChange(status)}
          variant="ghost"
        >
          {t(`projects.filters.${status}`)}
        </Button>
      ))}
    </div>
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
        className="h-9 rounded-lg bg-card pl-10 text-xs xl:pl-10"
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
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

  function handleSortChange(event: ChangeEvent<HTMLSelectElement>): void {
    const nextSortField = event.target.value;

    if (isProjectSortField(nextSortField)) {
      onSortChange(nextSortField);
    }
  }

  return (
    <label className="relative">
      <span className="sr-only">{t("projects.sort.label")}</span>
      <select
        className="h-9 w-full appearance-none rounded-xl bg-surface py-0 pr-9 pl-3 text-sm text-foreground shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-primary sm:w-56"
        value={sortField}
        onChange={handleSortChange}
      >
        {PROJECT_SORT_FIELDS.map((field) => (
          <option key={field} value={field}>
            {t(`projects.sort.${field}`)}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
    </label>
  );
}

/** Renders the status filter, the search field and the sort order of the project overview. */
export function ProjectsToolbar({
  filter,
  search,
  sortField,
  onFilterChange,
  onSearchChange,
  onSortChange,
}: ProjectsToolbarProps): React.ReactElement {
  return (
    <div className="mt-7 flex flex-wrap items-center gap-2.5">
      <ProjectStatusFilters filter={filter} onFilterChange={onFilterChange} />
      <ProjectSearchField search={search} onSearchChange={onSearchChange} />
      <ProjectSortSelect sortField={sortField} onSortChange={onSortChange} />
    </div>
  );
}
