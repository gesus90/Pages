import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { AutomationSwitch } from "@/app/components/automations/automation-switch";

import { PlanDialogFrame } from "./plan-dialog-frame";

/** The state of the one-time switch in the edit dialog, including its pending confirmation. */
export interface PlanOneShotChoice {
  readonly isOneShot: boolean;
  readonly isConfirming: boolean;
  /** Switching on asks first; switching off applies at once. */
  readonly request: (isWanted: boolean) => void;
  readonly confirm: () => void;
  readonly cancel: () => void;
}

/**
 * Keeps the choice of the one-time switch until the dialog saves.
 *
 * @param initial - Whether the plan is a one-time plan now.
 */
export function usePlanOneShotChoice(initial: boolean): PlanOneShotChoice {
  const [isOneShot, setOneShot] = useState(initial);
  const [isConfirming, setConfirming] = useState(false);
  return {
    isOneShot,
    isConfirming,
    request: (isWanted) => {
      if (isWanted) setConfirming(true);
      else setOneShot(false);
    },
    confirm: () => {
      setOneShot(true);
      setConfirming(false);
    },
    cancel: () => setConfirming(false),
  };
}

/**
 * The switch "Einmal-Plan" of the plan settings (PAGE-309).
 *
 * @remarks
 * Switching on is only requested here; the caller asks for confirmation
 * first. Switching off needs none.
 */
export function PlanOneShotField({
  choice,
  isDisabled,
}: {
  readonly choice: PlanOneShotChoice;
  readonly isDisabled: boolean;
}): React.ReactElement {
  const { isOneShot } = choice;
  const { t } = useTranslation();
  const hintId = useId();
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">
          {t("plans.manage.oneShot")}
        </p>
        <p id={hintId} className="text-xs text-muted-foreground">
          {t("plans.manage.oneShotHint")}
        </p>
      </div>
      <AutomationSwitch
        checked={isOneShot}
        label={t("plans.manage.oneShot")}
        disabled={isDisabled}
        onChange={() => choice.request(!isOneShot)}
      />
    </div>
  );
}

/**
 * Explains what a one-time plan deletes before the switch turns on.
 *
 * @remarks
 * It is a sibling of the edit dialog, never inside its form, so confirming
 * does not submit the edit form.
 */
export function PlanOneShotConfirmDialog({
  choice,
}: {
  readonly choice: PlanOneShotChoice;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (!choice.isConfirming) return null;
  return (
    <PlanDialogFrame
      title={t("plans.manage.oneShotConfirmTitle")}
      description={t("plans.manage.oneShotConfirmBody")}
      submitLabel={t("plans.manage.oneShotConfirm")}
      isPending={false}
      isSubmitDisabled={false}
      tone="destructive"
      hasCloseButton={false}
      error={null}
      onSubmit={choice.confirm}
      onClose={choice.cancel}
    >
      <p className="text-sm text-muted-foreground">
        {t("plans.manage.oneShotConfirmKept")}
      </p>
    </PlanDialogFrame>
  );
}
