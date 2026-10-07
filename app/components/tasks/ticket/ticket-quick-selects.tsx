import { useTranslation } from "react-i18next";

import { useAssigneeOptions } from "@/app/components/tasks/assignee-options";
import { usePriorityOptions } from "@/app/components/tasks/priority-options";
import { Select } from "@/app/components/ui/select";
import { toAssigneeValue } from "@/app/lib/assignee-value";

import type { WorkItemDetail, WorkflowStatus } from "@/definition/Task";
import type { User } from "@/definition/User";

interface TicketQuickSelectsProps {
  readonly ticket: WorkItemDetail;
  readonly statuses: readonly WorkflowStatus[];
  readonly assignees: readonly User[];
  readonly isArchived: boolean;
  readonly onChangeStatus: (statusId: string) => void;
  readonly onChangePriority: (priority: WorkItemDetail["priority"]) => void;
  readonly onChangeAssignee: (assignee: string) => void;
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
  const assigneeOptions = useAssigneeOptions(assignees, ticket.assigneeGroupId);

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
        value={toAssigneeValue(ticket)}
        onValueChange={onChangeAssignee}
        disabled={isArchived}
        options={assigneeOptions}
      />
    </div>
  );
}
