import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { isResumablePlanRunEnd } from "@/definition/AgentPlanRunState";

import type { AgentPlanControl } from "@/definition/AgentPlanControl";

/**
 * The newest run of the plan ended at a failure or open closeout and belongs
 * to another executor, so Starten would begin a new run beside it.
 */
export function isForeignEndedRun(
  control: AgentPlanControl | undefined,
): boolean {
  return (
    control !== undefined &&
    isResumablePlanRunEnd(control.status) &&
    control.resumeBlocker === "own_run_required"
  );
}

/**
 * Confirms that Starten begins a new run and continues nothing.
 *
 * @remarks
 * Only the executor of the ended run may continue it; this reader's plan
 * rights grant no control of it. A new run of the plan replaces the ended
 * run's records, so the decision is never taken by a single click.
 */
export function PlanForeignRunStartDialog({
  onConfirm,
  onClose,
}: {
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const [isConfirmed, setConfirmed] = useState(false);
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
            {t("plans.recovery.foreignStartTitle")}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {t("plans.recovery.foreignStartDescription")}
          </DialogDescription>
        </div>
        <label className="flex items-start gap-2 text-xs leading-4 text-muted-foreground [@media(pointer:coarse)]:min-h-11">
          <input
            type="checkbox"
            checked={isConfirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <span>{t("plans.recovery.foreignStartConfirm")}</span>
        </label>
        <div className="flex flex-wrap justify-end gap-1.5">
          <Button
            size="xs"
            variant="outline"
            onClick={onClose}
            className="[@media(pointer:coarse)]:h-11"
          >
            {t("plans.recovery.foreignStartCancel")}
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={!isConfirmed}
            onClick={handleConfirm}
            className="[@media(pointer:coarse)]:h-11"
          >
            {t("plans.recovery.foreignStartAction")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
