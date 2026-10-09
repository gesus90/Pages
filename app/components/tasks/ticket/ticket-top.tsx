import { TicketArchivedBanner } from "@/app/components/tasks/ticket/ticket-archived-banner";
import { TicketHeading } from "@/app/components/tasks/ticket/ticket-heading";

import type { TaskPanelActions } from "@/app/components/tasks/detail/use-task-panel-actions";
import type { WorkItemDetail } from "@/definition/Task";

interface TicketTopProps {
  readonly ticket: WorkItemDetail;
  readonly actions: TaskPanelActions;
  readonly canWrite: boolean;
  readonly isArchived: boolean;
  readonly isArchiving: boolean;
  readonly onBack: () => void;
  readonly onEdit: () => void;
  readonly onCreateChild: (() => void) | null;
}

/** Renders the heading with its actions and the archive notice of a ticket. */
export function TicketTop({
  ticket,
  actions,
  canWrite,
  isArchived,
  isArchiving,
  onBack,
  onEdit,
  onCreateChild,
}: TicketTopProps): React.ReactElement {
  return (
    <>
      <TicketHeading
        canWrite={canWrite}
        isArchived={isArchived}
        onBack={onBack}
        onCreateChild={onCreateChild}
        onEdit={onEdit}
        onSaveTitle={(title) => actions.update({ title })}
        ticket={ticket}
      />
      {isArchived ? (
        <TicketArchivedBanner isArchiving={isArchiving} ticketId={ticket.id} />
      ) : null}
    </>
  );
}
