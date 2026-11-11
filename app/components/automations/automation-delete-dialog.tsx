import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

import { AutomationFailureMessage } from "./automation-failure";

import type { AutomationsPageState } from "./use-automations-page";

/**
 * Asks before an automation and its runs are deleted; the confirmation is
 * the explicit consent the action sends as `confirmed`.
 */
export function AutomationDeleteDialog({
  page,
}: {
  readonly page: AutomationsPageState;
}): React.ReactElement {
  const { t } = page.context;
  const { deleteTarget, actions } = page;
  const failure = actions.failure?.intent === "delete" ? actions.failure : null;

  function handleOpenChange(isOpen: boolean): void {
    if (!isOpen) page.cancelDelete();
  }

  return (
    <Dialog open={deleteTarget !== null} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">
          {t("automations.delete.title")}
        </DialogTitle>
        <DialogDescription className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {t("automations.delete.text", { name: deleteTarget?.name ?? "" })}
        </DialogDescription>
        {failure ? (
          <div className="mt-3">
            <AutomationFailureMessage failure={failure} />
          </div>
        ) : null}
        <footer className="mt-6 flex justify-end gap-2">
          <Button onClick={page.cancelDelete} variant="ghost">
            {t("automations.delete.cancel")}
          </Button>
          <Button
            isPending={actions.busyIntent === "delete"}
            onClick={page.confirmDelete}
            variant="destructive"
          >
            {t("automations.delete.confirm")}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
