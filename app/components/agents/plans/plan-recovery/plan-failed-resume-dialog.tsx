import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

import { PlanRecoveryState } from "./plan-recovery-state";

import type { usePlanRecovery } from "../use-plan-recovery";

/** Confirms continuation with the saved revision and names the work that remains completed. */
export function PlanFailedResumeDialog({
  recovery,
  onClose,
}: {
  readonly recovery: ReturnType<typeof usePlanRecovery>;
  readonly onClose: () => void;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { view } = recovery;
  if (!view) return null;
  async function resume(): Promise<void> {
    if (!view) return;
    const answer = await recovery.submit({
      action: "resume",
      revision: view.currentPlanRevision,
      confirmContinue: true,
    });
    if (answer?.runId) onClose();
  }
  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen && !recovery.isPending) onClose();
      }}
    >
      <DialogContent size="lg" className="space-y-4 overflow-y-auto">
        <DialogTitle>{t("plans.panel.resume")}</DialogTitle>
        <DialogDescription>
          {t("plans.recovery.resumeConfirm")}
        </DialogDescription>
        <div className="space-y-3 text-xs text-muted-foreground">
          <PlanRecoveryState view={view} />
          {view.planRevision !== view.currentPlanRevision ? (
            <p role="note">{t("plans.recovery.completedChangesIgnored")}</p>
          ) : null}
          {view.resume.reusedStepIds.length > 0 ? (
            <div>
              <p>{t("plans.recovery.inheritedSteps")}</p>
              <ul>
                {view.resume.reusedStepIds.map((id) => (
                  <li key={id}>{view.stepNames[id] ?? id}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            disabled={recovery.isPending}
            onClick={onClose}
          >
            {t("settings.agents.cancel")}
          </Button>
          <Button
            disabled={recovery.isPending || !view.resume.available}
            onClick={() => void resume()}
          >
            {t("plans.panel.resume")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
