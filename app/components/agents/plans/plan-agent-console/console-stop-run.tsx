import { Square } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

/**
 * Stops the whole run from the header of the console, after a question.
 *
 * @remarks
 * Stopping ends every node of the run, not only this one; the dialog says so
 * before anything happens.
 */
export function ConsoleStopRun({
  onStop,
}: {
  readonly onStop: () => Promise<void>;
}): React.ReactElement {
  const { t } = useTranslation();
  const [isOpen, setOpen] = useState(false);
  const [isPending, setPending] = useState(false);
  async function confirm(): Promise<void> {
    setPending(true);
    try {
      await onStop();
    } finally {
      setPending(false);
      setOpen(false);
    }
  }
  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      <Button size="sm" variant="destructive" onClick={() => setOpen(true)}>
        <Square className="size-3.5 fill-current" aria-hidden="true" />
        {t("plans.console.stopRun")}
      </Button>
      <DialogContent>
        <DialogTitle className="text-base font-semibold">
          {t("plans.console.stopTitle")}
        </DialogTitle>
        <DialogDescription className="mt-2 text-sm text-muted-foreground">
          {t("plans.console.stopDescription")}
        </DialogDescription>
        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button size="sm" variant="outline">
              {t("plans.console.stopCancel")}
            </Button>
          </DialogClose>
          <Button
            size="sm"
            variant="destructive"
            disabled={isPending}
            onClick={() => void confirm()}
          >
            {t("plans.console.confirmStop")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
