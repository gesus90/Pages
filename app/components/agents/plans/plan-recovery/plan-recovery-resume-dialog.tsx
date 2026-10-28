import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

import { recoveryErrorText } from "../plan-recovery-panel";
import { PlanRecoveryResume } from "./plan-recovery-resume";
import { PlanRecoveryState } from "./plan-recovery-state";

import type {
  PlanRecoveryRequest,
  usePlanRecovery,
} from "../use-plan-recovery";

/**
 * Continues an ended run from its last safe state, after the executor's decision.
 *
 * @remarks
 * The dialog names the results taken over unchanged and the nodes that run
 * again as a new attempt; nothing is preselected. The server checks the
 * checkpoints, the revision, the rights and leftover processes again and
 * starts a new run linked to the ended one, or refuses with the reason. It
 * closes once that run started.
 */
export function PlanRecoveryResumeDialog({
  recovery,
  onClose,
}: {
  readonly recovery: ReturnType<typeof usePlanRecovery>;
  readonly onClose: () => void;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { view } = recovery;
  if (!view) return null;
  async function submit(request: PlanRecoveryRequest): Promise<void> {
    const answer = await recovery.submit(request);
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
        <div className="space-y-1.5">
          <DialogTitle className="text-lg font-semibold">
            {t("plans.recovery.resumeTitle")}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {t("plans.recovery.resumeDescription")}
          </DialogDescription>
        </div>
        <div className="space-y-3 text-xs leading-4 wrap-anywhere text-muted-foreground">
          <PlanRecoveryState view={view} />
          <PlanRecoveryResume
            view={view}
            isPending={recovery.isPending}
            onSubmit={(request) => void submit(request)}
          />
          {recovery.error ? (
            <p role="alert" className="text-destructive">
              {recoveryErrorText(
                t,
                recovery.error,
                recovery.cleanupFailure,
                view.stepNames,
              )}
            </p>
          ) : null}
        </div>
        <div className="flex justify-end">
          <Button
            variant="outline"
            disabled={recovery.isPending}
            onClick={onClose}
          >
            {t("settings.agents.cancel")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
