import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import type { AgentPlanRecoveryView } from "@/definition/AgentPlanRecovery";
import type { PlanRecoveryRequest } from "../use-plan-recovery";

/**
 * Starts the saved revision from the start, after the executor confirmed
 * that every node runs again; also releases what an unproven cleanup holds.
 */
export function PlanRecoveryRestart({
  view,
  isPending,
  onSubmit,
}: {
  readonly view: AgentPlanRecoveryView;
  readonly isPending: boolean;
  readonly onSubmit: (request: PlanRecoveryRequest) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const [isConfirmed, setConfirmed] = useState(false);
  const { restart, release } = view;
  function handleRestart(): void {
    onSubmit({
      action: "restart",
      revision: view.currentPlanRevision,
      confirmRepeat: true,
    });
  }
  function handleRelease(): void {
    onSubmit({ action: "release" });
  }
  return (
    <fieldset className="space-y-1.5" disabled={isPending}>
      <legend className="font-medium text-foreground">
        {t("plans.recovery.restart")}
      </legend>
      <p>
        {t("plans.recovery.restartHint", {
          revision: view.currentPlanRevision,
        })}
      </p>
      <label className="flex items-start gap-2 [@media(pointer:coarse)]:min-h-11">
        <input
          type="checkbox"
          disabled={!restart.available}
          checked={isConfirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        <span>{t("plans.recovery.confirmRepeat")}</span>
      </label>
      <div className="flex flex-wrap gap-1.5">
        <Button
          size="xs"
          variant="outline"
          disabled={!restart.available || !isConfirmed || isPending}
          onClick={handleRestart}
          className="[@media(pointer:coarse)]:h-11"
        >
          {t("plans.recovery.restartAction", {
            revision: view.currentPlanRevision,
          })}
        </Button>
        {release.available ? (
          <Button
            size="xs"
            variant="outline"
            disabled={isPending}
            onClick={handleRelease}
            className="[@media(pointer:coarse)]:h-11"
          >
            {t("plans.recovery.releaseAction")}
          </Button>
        ) : null}
      </div>
    </fieldset>
  );
}
