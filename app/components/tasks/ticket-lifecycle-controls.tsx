import { Archive, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import { useTicketAccess } from "@/app/components/tasks/ticket-access";
import { TicketTemplateSaveDialog } from "@/app/components/tasks/templates/ticket-template-save-dialog";
import { TicketDeleteDialog } from "@/app/components/tasks/ticket-delete-dialog";
import { Button } from "@/app/components/ui/button";

import type { WorkItemDetail } from "@/definition/Task";

interface TicketLifecycleControlsProps {
  readonly ticket: WorkItemDetail;
  readonly isArchiving: boolean;
  readonly redirectTo?: string;
}

/** Offers archive, restore and permanent deletion, or a notice when the visitor may do none of them. */
export function TicketLifecycleControls({
  ticket,
  isArchiving,
  redirectTo,
}: TicketLifecycleControlsProps): React.ReactElement | null {
  const { t } = useTranslation();
  const { canDelete, canWrite } = useTicketAccess();
  const isArchived = ticket.archivedAt !== null;

  if (!canWrite && !canDelete) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("tasks.permissions.readOnly")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {canWrite ? (
        <Form method="post">
          <input
            name="intent"
            type="hidden"
            value={isArchived ? "restore-task" : "archive-task"}
          />
          <input name="id" type="hidden" value={ticket.id} />
          <Button
            className={
              isArchived
                ? "w-full gap-1.5"
                : "w-full gap-1.5 text-destructive hover:text-destructive"
            }
            disabled={isArchiving}
            type="submit"
            variant={isArchived ? "outline" : "ghost"}
          >
            {isArchived ? (
              <RotateCcw className="size-4" aria-hidden="true" />
            ) : (
              <Archive className="size-4" aria-hidden="true" />
            )}
            {isArchived
              ? t("tasks.archived.restore")
              : t(
                  isArchiving
                    ? "tasks.actions.archiving"
                    : "tasks.actions.archive",
                )}
          </Button>
        </Form>
      ) : null}
      {canWrite ? <TicketTemplateSaveDialog ticket={ticket} /> : null}
      {canDelete ? (
        <TicketDeleteDialog redirectTo={redirectTo} ticket={ticket} />
      ) : null}
    </div>
  );
}
