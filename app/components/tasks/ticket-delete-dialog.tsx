import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, useActionData, useLocation, useNavigation } from "react-router";

import { ChildHandlingFields } from "@/app/components/tasks/lifecycle/child-handling-fields";
import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/app/components/ui/dialog";

import type { WorkItemDetail, WorkItemTypeCounts } from "@/definition/Task";

interface TicketDeleteDialogProps {
  readonly ticket: WorkItemDetail;
  readonly redirectTo?: string;
  /** Every descendant the deletion reaches; `null` when unknown. */
  readonly counts: WorkItemTypeCounts | null;
}

interface DeleteOutcome {
  readonly ok: boolean;
  readonly intent?: string;
  readonly error?: string;
}

/** Drops the selected ticket from the current address so the board closes its panel. */
function withoutSelectedItem(pathname: string, search: string): string {
  const params = new URLSearchParams(search);

  params.delete("item");

  const query = params.toString();

  return query ? `${pathname}?${query}` : pathname;
}

/** Requires explicit confirmation before a ticket and its subtree are deleted for good. */
export function TicketDeleteDialog({
  ticket,
  redirectTo,
  counts,
}: TicketDeleteDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const navigation = useNavigation();
  const location = useLocation();
  const outcome = useActionData<DeleteOutcome | undefined>();
  const pending =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "delete-task";
  const failure =
    outcome && !outcome.ok && outcome.intent === "delete-task"
      ? outcome.error
      : undefined;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          className="w-full gap-1.5 text-destructive hover:text-destructive"
          type="button"
          variant="ghost"
        >
          <Trash2 className="size-4" aria-hidden="true" />
          {t("tasks.delete.action")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">
          {t("tasks.delete.title", { key: ticket.key })}
        </DialogTitle>
        <DialogDescription className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {t("tasks.delete.hint")}
        </DialogDescription>
        <Form className="mt-5" method="post">
          <input name="intent" type="hidden" value="delete-task" />
          <input name="id" type="hidden" value={ticket.id} />
          <ChildHandlingFields
            counts={counts}
            subtasksNote={t("tasks.lifecycle.subtasksDeleted")}
            ticket={ticket}
          />
          <input
            name="redirectTo"
            type="hidden"
            value={
              redirectTo ??
              withoutSelectedItem(location.pathname, location.search)
            }
          />
          {failure ? (
            <p
              role="alert"
              className="pages-selectable text-sm text-destructive"
            >
              {t(`tasks.error.${failure}`, { defaultValue: failure })}
            </p>
          ) : null}
          <footer className="mt-6 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">{t("tasks.actions.cancel")}</Button>
            </DialogClose>
            <Button type="submit" variant="destructive" isPending={pending}>
              {t("tasks.delete.confirm")}
            </Button>
          </footer>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
