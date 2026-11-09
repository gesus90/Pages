import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

import { recoveryErrorText } from "../plan-recovery-panel";

import type { AgentPlanRecoveryView } from "@/definition/AgentPlanRecovery";
import type { usePlanRecovery } from "../use-plan-recovery";

/**
 * Asks once whether the run continues at its failure point, and continues it.
 *
 * @remarks
 * The one confirmation stands for the whole continuation: the server chooses
 * whether an earlier agent session continues or a new one starts, takes over
 * the verified results, runs only the open work again and checks rights,
 * revision, checkpoints and leftover processes first. Cancelling or closing
 * starts nothing. The dialog closes once the new run started; a refusal stays
 * visible and the button can be used again.
 */
export function PlanRecoveryResume({
  view,
  recovery,
  onClose,
}: {
  readonly view: AgentPlanRecoveryView;
  readonly recovery: ReturnType<typeof usePlanRecovery>;
  readonly onClose: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { resume } = view;
  const { isPending } = recovery;
  async function handleResume(): Promise<void> {
    const answer = await recovery.submit({
      action: "resume",
      revision: view.currentPlanRevision,
      confirmContinue: true,
    });
    if (answer?.runId) onClose();
  }
  function handleOpenChange(isOpen: boolean): void {
    if (!isOpen && !isPending) onClose();
  }
  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">
          {t("plans.recovery.resumeTitle")}
        </DialogTitle>
        <DialogDescription className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {t("plans.recovery.resumeConfirm")}
        </DialogDescription>
        {!resume.available && resume.reason ? (
          <p role="status" className="mt-3 text-sm text-warning">
            {t(`plans.recovery.blocker.${resume.reason}`)}
          </p>
        ) : null}
        {isPending ? (
          <p role="status" className="mt-3 text-sm text-muted-foreground">
            {t("plans.recovery.resumePending")}
          </p>
        ) : null}
        {recovery.error ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {recoveryErrorText(
              t,
              recovery.error,
              recovery.cleanupFailure,
              view.stepNames,
            )}
          </p>
        ) : null}
        <footer className="mt-6 flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={isPending}
            onClick={onClose}
          >
            {t("settings.agents.cancel")}
          </Button>
          <Button
            type="button"
            isPending={isPending}
            disabled={!resume.available}
            onClick={() => void handleResume()}
          >
            {t("plans.recovery.resumeAction")}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
