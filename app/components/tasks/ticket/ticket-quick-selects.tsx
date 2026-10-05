import { useTranslation } from "react-i18next";

import { usePriorityOptions } from "@/app/components/tasks/priority-options";
import { Select } from "@/app/components/ui/select";

import type { WorkItemDetail, WorkflowStatus } from "@/definition/Task";
import type { User } from "@/definition/User";

interface TicketQuickSelectsProps {
  readonly ticket: WorkItemDetail;
  readonly statuses: readonly WorkflowStatus[];
  readonly assignees: readonly User[];
  readonly isArchived: boolean;
  readonly onChangeStatus: (statusId: string) => void;
  readonly onChangePriority: (priority: WorkItemDetail["priority"]) => void;
  readonly onChangeAssignee: (assigneeId: string) => void;
}

/** Renders the status, priority and assignee selects below the heading. */
export function TicketQuickSelects({
  ticket,
  statuses,
  assignees,
  isArchived,
  onChangeStatus,
  onChangePriority,
  onChangeAssignee,
}: TicketQuickSelectsProps): React.ReactElement {
  const { t } = useTranslation();
  const priorityOptions = usePriorityOptions();

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <Select
        ariaLabel={t("tasks.fields.status")}
        value={ticket.statusId}
        onValueChange={onChangeStatus}
        disabled={isArchived}
        options={statuses.map((status) => ({
          value: status.id,
          label: status.name,
        }))}
      />

      <Select
        ariaLabel={t("tasks.fields.priority")}
        value={ticket.priority}
        onValueChange={onChangePriority}
        disabled={isArchived}
        options={priorityOptions}
      />

      <Select
        ariaLabel={t("tasks.fields.assignee")}
        value={ticket.assigneeId ?? ""}
        onValueChange={onChangeAssignee}
        disabled={isArchived}
        options={[
          { value: "", label: t("tasks.unassigned") },
          ...assignees.map((assignee) => ({
            value: assignee.id,
            label: assignee.displayName,
          })),
        ]}
      />
    </div>
  );
}
