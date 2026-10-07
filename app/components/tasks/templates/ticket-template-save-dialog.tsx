import { BookmarkPlus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/app/components/ui/dialog";
import { showSuccessToast } from "@/app/components/ui/toast";
import { TEMPLATE_SCOPE } from "@/definition/WorkItemTemplate";

import { TemplateDetailsForm } from "./template-details-form";

import type { WorkItemDetail } from "@/definition/Task";

interface TicketTemplateSaveDialogProps {
  readonly ticket: WorkItemDetail;
}

/** Saves a ticket's content as a template that is private until its audience is chosen. */
export function TicketTemplateSaveDialog({
  ticket,
}: TicketTemplateSaveDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  function handleSaved(): void {
    setIsOpen(false);
    showSuccessToast(t("tasks.templates.saved"));
  }

  return (
    <Dialog onOpenChange={setIsOpen} open={isOpen}>
      <DialogTrigger asChild>
        <Button className="w-full gap-1.5" type="button" variant="ghost">
          <BookmarkPlus className="size-4" aria-hidden="true" />
          {t("tasks.templates.saveAction")}
        </Button>
      </DialogTrigger>
      <DialogContent size="md">
        <DialogTitle className="text-lg font-semibold">
          {t("tasks.templates.saveTitle", { key: ticket.key })}
        </DialogTitle>
        <DialogDescription className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {t("tasks.templates.saveHint")}
        </DialogDescription>
        <TemplateDetailsForm
          cancel={
            <DialogClose asChild>
              <Button variant="ghost">{t("tasks.actions.cancel")}</Button>
            </DialogClose>
          }
          idPrefix="save-template"
          initialName={ticket.title}
          initialSharing={{
            departmentIds: [],
            projectIds: [],
            scope: TEMPLATE_SCOPE.PRIVATE,
          }}
          onSaved={handleSaved}
          target={{ field: "ticketId", id: ticket.id }}
        />
      </DialogContent>
    </Dialog>
  );
}
