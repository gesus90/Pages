import { useTranslation } from "react-i18next";
import { useActionData } from "react-router";

import { TicketArchiveDialog } from "./ticket-archive-dialog";

import type { WorkItemDescendants, WorkItemDetail } from "@/definition/Task";

interface TicketArchiveActionProps {
  readonly ticket: Pick<
    WorkItemDetail,
    "archivedAt" | "id" | "key" | "statusName" | "title" | "type"
  >;
  /** What the archive reaches and whether the visitor may archive; `null` when unknown. */
  readonly descendants: WorkItemDescendants | null;
  readonly isArchiving: boolean;
  /** Sizes the trigger for the place it sits in. */
  readonly triggerClassName?: string;
  /** Shows only the symbol on small screens, where room is short. */
  readonly isCompact?: boolean;
}

interface ActionOutcome {
  readonly ok: boolean;
  readonly intent?: string;
  readonly error?: string;
}

/**
 * Offers to archive a ticket to the people who may, and says why a request
 * was refused.
 *
 * @remarks
 * The right comes from the server with the descendants of the ticket and is
 * only a hint for the control; archiving checks it again. Without it, for an
 * archived ticket, and while the answer is unknown, no control is shown. A
 * refusal stays visible even then, because the hint is renewed together with
 * the answer and the control may be gone by the time the answer arrives.
 */
export function TicketArchiveAction({
  ticket,
  descendants,
  isArchiving,
  triggerClassName,
  isCompact = false,
}: TicketArchiveActionProps): React.ReactElement | null {
  const { t } = useTranslation();
  const outcome = useActionData<ActionOutcome | undefined>();
  const failure =
    outcome && !outcome.ok && outcome.intent === "archive-task"
      ? outcome.error
      : undefined;
  const offered =
    ticket.archivedAt === null && descendants?.canArchive === true
      ? descendants
      : null;

  if (offered === null && !failure) {
    return null;
  }

  return (
    <>
      {offered ? (
        <TicketArchiveDialog
          counts={offered.active}
          isArchiving={isArchiving}
          isCompact={isCompact}
          ticket={ticket}
          triggerClassName={triggerClassName}
        />
      ) : null}
      {failure ? (
        <span
          className="pages-selectable text-xs text-destructive"
          role="alert"
        >
          {t(`tasks.error.${failure}`, { defaultValue: failure })}
        </span>
      ) : null}
    </>
  );
}
