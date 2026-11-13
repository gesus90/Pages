import { useTranslation } from "react-i18next";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

import { recoveryErrorText } from "../plan-recovery-panel";
import { PlanRecoveryRestart } from "./plan-recovery-restart";

import type {
  PlanRecoveryRequest,
  usePlanRecovery,
} from "../use-plan-recovery";

/** Confirms a restart and shows a server refusal without closing the dialog. */
export function PlanRecoveryResumeDialog({
  recovery,
  planName,
  onClose,
}: {
  readonly recovery: ReturnType<typeof usePlanRecovery>;
  readonly planName: string;
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
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">
          {t("plans.recovery.restartDialogTitle")}
        </DialogTitle>
        <DialogDescription className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {t("plans.recovery.restartDialogDescription")}
        </DialogDescription>
        <p className="mt-3 text-xs text-muted-foreground">
          {t("plans.recovery.restartDialogContext", {
            plan: planName,
            run: view.runId.slice(0, 8),
            state: t(`plans.recovery.state.${view.state}`),
          })}
        </p>
        {recovery.error ? (
          <p role="alert" className="mt-3 text-xs text-destructive">
            {t("plans.recovery.restartDialogError", {
              reason: recoveryErrorText(t, recovery.error, recovery.cleanupFailure, view.stepNames),
              code: recovery.error,
            })}
          </p>
        ) : null}
        <PlanRecoveryRestart
          view={view}
          isPending={recovery.isPending}
          hasError={Boolean(recovery.error)}
          onSubmit={(request) => void submit(request)}
          onClose={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}
