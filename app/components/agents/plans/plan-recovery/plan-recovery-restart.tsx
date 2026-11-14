import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import type { AgentPlanRecoveryView } from "@/definition/AgentPlanRecovery";
import type { PlanRecoveryRequest } from "../use-plan-recovery";

/** Submits the confirmations represented by the restart dialog. */
export function PlanRecoveryRestart({
  view,
  isPending,
  hasError,
  onSubmit,
  onClose,
}: {
  readonly view: AgentPlanRecoveryView;
  readonly isPending: boolean;
  readonly hasError: boolean;
  readonly onSubmit: (request: PlanRecoveryRequest) => void;
  readonly onClose: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  function handleRestart(): void {
    onSubmit({
      action: "restart",
      revision: view.currentPlanRevision,
      confirmRepeat: true,
      reviewedStepIds: view.restart.reviewStepIds ?? [],
    });
  }
  let actionLabel = t("plans.recovery.restartDialogAction");
  if (isPending) actionLabel = t("plans.recovery.restartDialogPending");
  else if (hasError) actionLabel = t("plans.recovery.restartDialogRetry");
  return (
    <footer className="mt-6 flex justify-end gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={onClose}
      >
        {t("settings.agents.cancel")}
      </Button>
      <Button size="sm" isPending={isPending} onClick={handleRestart}>
        {actionLabel}
      </Button>
    </footer>
  );
}
