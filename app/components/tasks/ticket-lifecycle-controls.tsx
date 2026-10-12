import { RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import { useTicketAccess } from "@/app/components/tasks/ticket-access";
import { TicketTemplateSaveDialog } from "@/app/components/tasks/templates/ticket-template-save-dialog";
import { TicketDeleteDialog } from "@/app/components/tasks/ticket-delete-dialog";
import { Button } from "@/app/components/ui/button";

import type { WorkItemDescendants, WorkItemDetail } from "@/definition/Task";

interface TicketLifecycleControlsProps {
  readonly ticket: WorkItemDetail;
  readonly isArchiving: boolean;
  readonly redirectTo?: string;
  /** The descendants archiving or deleting reaches; `null` when unknown. */
  readonly descendants: WorkItemDescendants | null;
}

/**
 * Offers restore, template and permanent deletion, or a notice when the
 * visitor may do none of them. Archiving sits with the actions of the ticket.
 */
export function TicketLifecycleControls({
  ticket,
  isArchiving,
  redirectTo,
  descendants,
}: TicketLifecycleControlsProps): React.ReactElement | null {
  const { t } = useTranslation();
  const { canDelete, canWrite } = useTicketAccess();
  const isArchived = ticket.archivedAt !== null;

  if (!canWrite && !canDelete) {
    // Whoever is offered the archive control is no mere reader.
    const isOfferedArchive = descendants?.canArchive === true && !isArchived;

    return isOfferedArchive ? null : (
      <p className="text-xs text-muted-foreground">
        {t("tasks.permissions.readOnly")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {canWrite && isArchived ? (
        <Form method="post">
          <input name="intent" type="hidden" value="restore-task" />
          <input name="id" type="hidden" value={ticket.id} />
          <Button
            className="w-full gap-1.5"
            disabled={isArchiving}
            type="submit"
            variant="outline"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            {t("tasks.archived.restore")}
          </Button>
        </Form>
      ) : null}
      {canWrite ? <TicketTemplateSaveDialog ticket={ticket} /> : null}
      {canDelete ? (
        <TicketDeleteDialog
          counts={descendants?.all ?? null}
          redirectTo={redirectTo}
          ticket={ticket}
        />
      ) : null}
    </div>
  );
}
