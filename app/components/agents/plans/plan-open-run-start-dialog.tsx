import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

/**
 * Asks whether the open run ends so Starten can begin a new run from the start.
 *
 * @remarks
 * Starten never continues anything. While a run is open, a click alone would
 * silently discard its progress, so this dialog names the consequence: the run
 * is stopped, its own processes end and its working copies are released.
 * Continuing the open run is Fortsetzen.
 */
export function PlanOpenRunStartDialog({
  onConfirm,
  onClose,
}: {
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  function handleConfirm(): void {
    onConfirm();
    onClose();
  }
  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent size="md" className="space-y-4">
        <div className="space-y-1.5">
          <DialogTitle className="text-lg font-semibold">
            {t("plans.openRun.title")}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {t("plans.openRun.description")}
          </DialogDescription>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          <Button
            size="xs"
            variant="outline"
            onClick={onClose}
            className="[@media(pointer:coarse)]:h-11"
          >
            {t("plans.openRun.cancel")}
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={handleConfirm}
            className="[@media(pointer:coarse)]:h-11"
          >
            {t("plans.openRun.confirm")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
