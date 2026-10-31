import { Archive } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/app/components/ui/dialog";
import { cn } from "@/app/lib/cn";

import { ChildHandlingFields } from "./child-handling-fields";

import type { WorkItemDetail, WorkItemTypeCounts } from "@/definition/Task";

interface TicketArchiveDialogProps {
  readonly ticket: Pick<
    WorkItemDetail,
    "id" | "key" | "statusName" | "title" | "type"
  >;
  /** Active descendants that the archive reaches. */
  readonly counts: WorkItemTypeCounts | null;
  readonly isArchiving: boolean;
  /** Sizes the trigger for the place it sits in. */
  readonly triggerClassName?: string;
  /** Shows only the symbol on small screens; the label stays for assistive technology. */
  readonly isCompact?: boolean;
}

/**
 * Asks before a ticket is archived: it names the ticket and what the archive
 * does to it and, for initiatives and epics, how many active descendants
 * across all levels go along or stay behind; nothing disappears without being
 * named (A8.2-E04). Cancelling sends nothing.
 */
export function TicketArchiveDialog({
  ticket,
  counts,
  isArchiving,
  triggerClassName,
  isCompact = false,
}: TicketArchiveDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button
          className={cn("gap-1.5", triggerClassName)}
          disabled={isArchiving}
          type="button"
          variant="outline"
        >
          <Archive aria-hidden="true" className="size-4" />
          <span className={cn(isCompact && "max-sm:sr-only")}>
            {t(
              isArchiving ? "tasks.actions.archiving" : "tasks.actions.archive",
            )}
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">
          {t("tasks.lifecycle.archiveTitle", { key: ticket.key })}
        </DialogTitle>
        <DialogDescription className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {t("tasks.lifecycle.archiveEffect", {
            key: ticket.key,
            status: ticket.statusName,
            title: ticket.title,
          })}
        </DialogDescription>
        <Form
          className="mt-4 flex flex-col gap-4"
          method="post"
          onSubmit={() => setIsOpen(false)}
        >
          <input name="intent" type="hidden" value="archive-task" />
          <input name="boardLocal" type="hidden" value="true" />
          <input name="id" type="hidden" value={ticket.id} />
          <ChildHandlingFields
            affectedKey="tasks.lifecycle.archiveAffected"
            counts={counts}
            subtasksNote={t("tasks.lifecycle.subtasksArchived")}
            ticket={ticket}
          />
          <footer className="mt-2 flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {t("tasks.actions.cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" variant="destructive">
              {t("tasks.lifecycle.archiveConfirm")}
            </Button>
          </footer>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
