import { Flag, Kanban, List, Network, Plus, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { SegmentedControl } from "@/app/components/ui/segmented-control";
import { Select } from "@/app/components/ui/select";
import { FILTER_ALL } from "@/app/lib/task-filters";
import { WORK_ITEM_PRIORITY, WORK_ITEM_TYPE } from "@/definition/Task";

import type { TaskFilterState } from "@/app/components/tasks/board/use-task-filters";
import type { SegmentedControlOption } from "@/app/components/ui/segmented-control";
import type { ArchivedFilter, TasksViewMode } from "@/app/lib/tasks-view";
import type { Project } from "@/definition/Project";
import type { Milestone, WorkflowStatus } from "@/definition/Task";

interface FilterSelectsProps {
  readonly state: TaskFilterState;
  readonly projects: readonly Project[];
  readonly statuses: readonly WorkflowStatus[];
  readonly milestones: readonly Milestone[];
  readonly archivedFilter: ArchivedFilter;
  readonly onArchivedChange: (value: ArchivedFilter) => void;
}

/** Renders the project, type, status, priority, milestone and archive selects. */
function FilterSelects({
  state,
  projects,
  statuses,
  milestones,
  archivedFilter,
  onArchivedChange,
}: FilterSelectsProps): React.ReactElement {
  const { t } = useTranslation();
  const { filters, setFilter } = state;

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <Select
        ariaLabel={t("tasks.filter.allProjects")}
        value={filters.project}
        onValueChange={(value) => setFilter("project", value)}
        options={[
          { value: FILTER_ALL, label: t("tasks.filter.allProjects") },
          ...projects.map((project) => ({
            value: project.id,
            label: project.name,
          })),
        ]}
      />

      <Select
        ariaLabel={t("tasks.filter.allTypes")}
        value={filters.type}
        onValueChange={(value) => setFilter("type", value)}
        options={[
          { value: FILTER_ALL, label: t("tasks.filter.allTypes") },
          {
            value: WORK_ITEM_TYPE.INITIATIVE,
            label: t("tasks.type.initiative"),
          },
          { value: WORK_ITEM_TYPE.EPIC, label: t("tasks.type.epic") },
          { value: WORK_ITEM_TYPE.TASK, label: t("tasks.type.task") },
          { value: WORK_ITEM_TYPE.SUBTASK, label: t("tasks.type.subtask") },
        ]}
      />

      <Select
        ariaLabel={t("tasks.filter.allStatuses")}
        value={filters.status}
        onValueChange={(value) => setFilter("status", value)}
        options={[
          { value: FILTER_ALL, label: t("tasks.filter.allStatuses") },
          ...statuses.map((status) => ({
            value: status.id,
            label: status.name,
          })),
        ]}
      />

      <Select
        ariaLabel={t("tasks.filter.allPriorities")}
        value={filters.priority}
        onValueChange={(value) => setFilter("priority", value)}
        options={[
          { value: FILTER_ALL, label: t("tasks.filter.allPriorities") },
          {
            value: WORK_ITEM_PRIORITY.URGENT,
            label: t("tasks.priority.urgent"),
          },
          { value: WORK_ITEM_PRIORITY.HIGH, label: t("tasks.priority.high") },
          {
            value: WORK_ITEM_PRIORITY.NORMAL,
            label: t("tasks.priority.normal"),
          },
          { value: WORK_ITEM_PRIORITY.LOW, label: t("tasks.priority.low") },
        ]}
      />

      {milestones.length > 0 ? (
        <Select
          ariaLabel={t("tasks.filter.allMilestones")}
          value={filters.milestone}
          onValueChange={(value) => setFilter("milestone", value)}
          options={[
            { value: FILTER_ALL, label: t("tasks.filter.allMilestones") },
            ...milestones.map((milestone) => ({
              value: milestone.id,
              label: milestone.name,
            })),
          ]}
        />
      ) : null}

      <Select
        ariaLabel={t("tasks.filter.archived")}
        value={archivedFilter}
        onValueChange={onArchivedChange}
        options={[
          { value: "active", label: t("tasks.filter.active") },
          { value: "archived", label: t("tasks.filter.archivedTickets") },
          { value: "all", label: t("tasks.filter.all") },
        ]}
      />
    </div>
  );
}

interface TasksToolbarProps extends FilterSelectsProps {
  readonly viewMode: TasksViewMode;
  readonly onViewModeChange: (value: TasksViewMode) => void;
  readonly onCreate: () => void;
}

/** Renders the page title, the filters and the switch between task views. */
export function TasksToolbar(props: TasksToolbarProps): React.ReactElement {
  const { t } = useTranslation();
  const { state, viewMode, onViewModeChange, onCreate } = props;
  const viewOptions: SegmentedControlOption<TasksViewMode>[] = [
    {
      icon: <Kanban className="size-3.5" aria-hidden="true" />,
      label: t("tasks.view.kanban"),
      value: "kanban",
    },
    {
      icon: <List className="size-3.5" aria-hidden="true" />,
      label: t("tasks.view.list"),
      value: "list",
    },
    {
      icon: <Network className="size-3.5" aria-hidden="true" />,
      label: t("tasks.view.hierarchy"),
      value: "hierarchy",
    },
    {
      icon: <Flag className="size-3.5" aria-hidden="true" />,
      label: t("tasks.view.milestones"),
      value: "milestones",
    },
    { label: t("tasks.view.github"), value: "github" },
  ];

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="select-none text-3xl font-semibold tracking-tight text-foreground xl:text-2xl">
            {t("tasks.title")}
          </h1>
          <p className="mt-1.5 select-none text-sm text-muted-foreground">
            {t("tasks.subtitle")}
          </p>
        </div>

        <Button className="gap-2" onClick={onCreate} type="button">
          <Plus className="size-4" aria-hidden="true" />
          {t("tasks.create.trigger")}
        </Button>
      </div>

      <div className="mt-7 flex shrink-0 flex-wrap items-center gap-2.5">
        <SegmentedControl
          ariaLabel={t("tasks.filter.scope")}
          onValueChange={(scope) => state.setFilter("scope", scope)}
          options={[
            { label: t("tasks.filter.myTasks"), value: "mine" },
            { label: t("tasks.filter.allTasks"), value: "all" },
          ]}
          value={state.filters.scope}
        />

        <div className="relative h-9 min-w-52 flex-1 sm:max-w-80">
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            className="h-9 rounded-lg bg-card pl-10 text-xs xl:h-9 xl:pl-10 xl:text-xs"
            placeholder={t("tasks.search")}
            value={state.filters.search}
            onChange={(event) => state.setFilter("search", event.target.value)}
          />
        </div>

        <FilterSelects {...props} />
      </div>

      <div className="mt-3 flex shrink-0 justify-start">
        <SegmentedControl
          ariaLabel={t("tasks.view.label")}
          onValueChange={onViewModeChange}
          options={viewOptions}
          value={viewMode}
        />
      </div>
    </>
  );
}
