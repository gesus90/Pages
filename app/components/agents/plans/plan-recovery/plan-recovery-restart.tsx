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
  const [reviewed, setReviewed] = useState<readonly string[]>([]);
  const reviewIds = view.restart.reviewStepIds ?? [];
  const areEffectsReviewed = reviewIds.every((id) => reviewed.includes(id));
  const { restart } = view;
  function handleRestart(): void {
    onSubmit({
      action: "restart",
      revision: view.currentPlanRevision,
      confirmRepeat: true,
      reviewedStepIds: reviewed,
    });
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
      {reviewIds.map((id) => (
        <label
          key={id}
          className="flex items-start gap-2 [@media(pointer:coarse)]:min-h-11"
        >
          <input
            type="checkbox"
            checked={reviewed.includes(id)}
            onChange={(event) =>
              setReviewed(
                event.target.checked
                  ? [...reviewed, id]
                  : reviewed.filter((entry) => entry !== id),
              )
            }
          />
          <span>
            {t("plans.recovery.reviewScript", {
              step: view.stepNames[id] ?? id,
            })}
          </span>
        </label>
      ))}
      <div className="flex flex-wrap gap-1.5">
        <Button
          size="xs"
          variant="outline"
          disabled={
            !restart.available ||
            !isConfirmed ||
            !areEffectsReviewed ||
            isPending
          }
          onClick={handleRestart}
          className="[@media(pointer:coarse)]:h-11"
        >
          {t("plans.recovery.restartAction", {
            revision: view.currentPlanRevision,
          })}
        </Button>
      </div>
    </fieldset>
  );
}
