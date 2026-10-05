import { TicketArchivedBanner } from "@/app/components/tasks/ticket/ticket-archived-banner";
import { TicketHeading } from "@/app/components/tasks/ticket/ticket-heading";
import { TicketQuickSelects } from "@/app/components/tasks/ticket/ticket-quick-selects";

import type { TaskPanelActions } from "@/app/components/tasks/detail/use-task-panel-actions";
import type { WorkItemDetail, WorkflowStatus } from "@/definition/Task";
import type { User } from "@/definition/User";

interface TicketTopProps {
  readonly ticket: WorkItemDetail;
  readonly statuses: readonly WorkflowStatus[];
  readonly assignees: readonly User[];
  readonly actions: TaskPanelActions;
  readonly isArchived: boolean;
  readonly isArchiving: boolean;
  readonly onBack: () => void;
  readonly onEdit: () => void;
}

/** Renders the heading, the quick selects and the archive notice of a ticket. */
export function TicketTop({
  ticket,
  statuses,
  assignees,
  actions,
  isArchived,
  isArchiving,
  onBack,
  onEdit,
}: TicketTopProps): React.ReactElement {
  return (
    <>
      <TicketHeading
        isArchived={isArchived}
        onBack={onBack}
        onEdit={onEdit}
        ticket={ticket}
      />
      <TicketQuickSelects
        assignees={assignees}
        isArchived={isArchived}
        onChangeAssignee={(assigneeId) => actions.update({ assigneeId })}
        onChangePriority={(priority) => actions.update({ priority })}
        onChangeStatus={actions.changeStatus}
        statuses={statuses}
        ticket={ticket}
      />
      {isArchived ? (
        <TicketArchivedBanner isArchiving={isArchiving} ticketId={ticket.id} />
      ) : null}
    </>
  );
}
