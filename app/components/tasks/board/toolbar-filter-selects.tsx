import { useTranslation } from "react-i18next";

import { Select } from "@/app/components/ui/select";
import { FILTER_ALL } from "@/app/lib/task-filters";

import type { BoardPreferencesState } from "@/app/components/tasks/board/use-board-preferences";
import type { ArchivedFilter } from "@/app/lib/tasks-view";
import type { Project } from "@/definition/Project";
import type { Milestone, WorkflowStatus } from "@/definition/Task";

export interface ToolbarFilterSelectsProps {
  readonly board: BoardPreferencesState;
  readonly projects: readonly Project[];
  readonly statuses: readonly WorkflowStatus[];
  readonly milestones: readonly Milestone[];
  readonly archivedFilter: ArchivedFilter;
  readonly onArchivedChange: (value: ArchivedFilter) => void;
}

const TYPE_OPTION_VALUES = [
  "work",
  "all",
  "initiative",
  "epic",
  "task",
  "subtask",
] as const;

const PRIORITY_OPTION_VALUES = ["urgent", "high", "normal", "low"] as const;

/** Renders the project, type, status, priority, milestone and archive selects. */
export function ToolbarFilterSelects({
  board,
  projects,
  statuses,
  milestones,
  archivedFilter,
  onArchivedChange,
}: ToolbarFilterSelectsProps): React.ReactElement {
  const { t } = useTranslation();
  const { preferences, update } = board;

  return (
    <>
      <Select
        ariaLabel={t("tasks.filter.project")}
        value={preferences.project}
        onValueChange={(project) => update({ project })}
        options={[
          { value: FILTER_ALL, label: t("tasks.filter.allProjects") },
          ...projects.map((project) => ({
            value: project.id,
            label: project.name,
          })),
        ]}
      />

      <Select
        ariaLabel={t("tasks.filter.type")}
        value={preferences.type}
        onValueChange={(type) => update({ type })}
        options={TYPE_OPTION_VALUES.map((value) => ({
          value,
          label: t(`tasks.filter.typeOption.${value}`),
        }))}
      />

      <Select
        ariaLabel={t("tasks.filter.status")}
        value={preferences.status}
        onValueChange={(status) => update({ status })}
        options={[
          { value: FILTER_ALL, label: t("tasks.filter.allStatuses") },
          ...statuses.map((status) => ({
            value: status.id,
            label: status.name,
          })),
        ]}
      />

      <Select
        ariaLabel={t("tasks.filter.priority")}
        value={preferences.priority}
        onValueChange={(priority) => update({ priority })}
        options={[
          { value: FILTER_ALL, label: t("tasks.filter.allPriorities") },
          ...PRIORITY_OPTION_VALUES.map((value) => ({
            value,
            label: t(`tasks.priority.${value}`),
          })),
        ]}
      />

      {milestones.length > 0 ? (
        <Select
          ariaLabel={t("tasks.filter.milestone")}
          value={preferences.milestone}
          onValueChange={(milestone) => update({ milestone })}
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
    </>
  );
}
