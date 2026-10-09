import { Archive } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/app/components/ui/dialog";

import { ChildHandlingFields } from "./child-handling-fields";

import type { WorkItemDetail, WorkItemTypeCounts } from "@/definition/Task";

interface TicketArchiveDialogProps {
  readonly ticket: Pick<WorkItemDetail, "id" | "key" | "type">;
  /** Active descendants that the archive reaches. */
  readonly counts: WorkItemTypeCounts | null;
  readonly isArchiving: boolean;
}

/**
 * Asks before a ticket with children is archived and how its children are
 * handled; nothing disappears without being named (A8.2-E04).
 */
export function TicketArchiveDialog({
  ticket,
  counts,
  isArchiving,
}: TicketArchiveDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button
          className="w-full gap-1.5 text-destructive hover:text-destructive"
          disabled={isArchiving}
          type="button"
          variant="ghost"
        >
          <Archive aria-hidden="true" className="size-4" />
          {t(isArchiving ? "tasks.actions.archiving" : "tasks.actions.archive")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">
          {t("tasks.lifecycle.archiveTitle", { key: ticket.key })}
        </DialogTitle>
        <Form
          className="mt-4 flex flex-col gap-4"
          method="post"
          onSubmit={() => setIsOpen(false)}
        >
          <input name="intent" type="hidden" value="archive-task" />
          <input name="id" type="hidden" value={ticket.id} />
          <ChildHandlingFields
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
