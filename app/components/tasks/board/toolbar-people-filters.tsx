import { useTranslation } from "react-i18next";

import { LabelFilter } from "@/app/components/tasks/board/label-filter";
import { useAssigneeOptions } from "@/app/components/tasks/assignee-options";
import { useTicketAccess } from "@/app/components/tasks/ticket-access";
import { Select } from "@/app/components/ui/select";
import { FILTER_ALL } from "@/app/lib/task-filters";
import { BOARD_FILTER_NONE } from "@/definition/BoardPreferences";

import type { BoardPreferencesState } from "@/app/components/tasks/board/use-board-preferences";
import type { Label } from "@/definition/Task";
import type { User } from "@/definition/User";

interface ToolbarPeopleFiltersProps {
  readonly board: BoardPreferencesState;
  readonly assignees: readonly User[];
  readonly labels: readonly Label[];
}

/** Renders the assignee, department and label filters. */
export function ToolbarPeopleFilters({
  board,
  assignees,
  labels,
}: ToolbarPeopleFiltersProps): React.ReactElement {
  const { t } = useTranslation();
  const { departments } = useTicketAccess();
  const assigneeOptions = useAssigneeOptions(assignees);
  const { preferences, update } = board;

  return (
    <>
      <Select
        ariaLabel={t("tasks.filter.assignee")}
        value={preferences.assignee}
        onValueChange={(assignee) => update({ assignee })}
        options={[
          { value: FILTER_ALL, label: t("tasks.filter.allAssignees") },
          ...assigneeOptions.map((option) =>
            option.value === ""
              ? { ...option, value: BOARD_FILTER_NONE }
              : option,
          ),
        ]}
      />

      <Select
        ariaLabel={t("tasks.filter.department")}
        value={preferences.department}
        onValueChange={(department) => update({ department })}
        options={[
          { value: FILTER_ALL, label: t("tasks.filter.allDepartments") },
          { value: BOARD_FILTER_NONE, label: t("tasks.filter.noDepartment") },
          ...departments.map((department) => ({
            value: department.id,
            label: department.name,
          })),
        ]}
      />

      <LabelFilter
        labels={labels}
        onChange={(labelIds) => update({ labelIds })}
        selectedIds={preferences.labelIds}
      />
    </>
  );
}
