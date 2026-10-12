import { TicketArchiveAction } from "@/app/components/tasks/lifecycle/ticket-archive-action";
import { TicketArchivedBanner } from "@/app/components/tasks/ticket/ticket-archived-banner";
import { TicketHeading } from "@/app/components/tasks/ticket/ticket-heading";

import type { TaskPanelActions } from "@/app/components/tasks/detail/use-task-panel-actions";
import type { WorkItemDescendants, WorkItemDetail } from "@/definition/Task";

interface TicketTopProps {
  readonly ticket: WorkItemDetail;
  readonly actions: TaskPanelActions;
  readonly canWrite: boolean;
  readonly isArchived: boolean;
  readonly isArchiving: boolean;
  /** What archiving reaches and whether the visitor may archive; `null` when unknown. */
  readonly descendants: WorkItemDescendants | null;
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
  descendants,
  onBack,
  onEdit,
  onCreateChild,
}: TicketTopProps): React.ReactElement {
  return (
    <>
      <TicketHeading
        archiveAction={
          <TicketArchiveAction
            descendants={descendants}
            isArchiving={isArchiving}
            ticket={ticket}
          />
        }
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
