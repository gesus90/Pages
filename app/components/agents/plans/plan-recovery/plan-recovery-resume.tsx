import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import type { AgentPlanRecoveryView } from "@/definition/AgentPlanRecovery";
import type { PlanRecoveryRequest } from "../use-plan-recovery";

type ResumeMode = "native_resume" | "new_session";

/**
 * Continues the run from its last safe state.
 *
 * @remarks
 * The executor sees which results are taken over unchanged, chooses whether
 * an earlier agent session is continued or a new one starts, and confirms
 * for each started node that its possible effects were reviewed. Nothing
 * is preselected.
 */
export function PlanRecoveryResume({
  view,
  isPending,
  onSubmit,
}: {
  readonly view: AgentPlanRecoveryView;
  readonly isPending: boolean;
  readonly onSubmit: (request: PlanRecoveryRequest) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const [mode, setMode] = useState<ResumeMode | null>(null);
  const [reviewed, setReviewed] = useState<readonly string[]>([]);
  const { resume } = view;
  const isReviewed = resume.reviewStepIds.every((id) => reviewed.includes(id));
  const canSubmit =
    resume.available && mode !== null && isReviewed && !isPending;
  function toggle(id: string, isChecked: boolean): void {
    setReviewed(
      isChecked ? [...reviewed, id] : reviewed.filter((entry) => entry !== id),
    );
  }
  function handleResume(): void {
    if (mode === null) return;
    onSubmit({
      action: "resume",
      mode,
      revision: view.currentPlanRevision,
      reviewedStepIds: reviewed,
    });
  }
  return (
    <fieldset className="space-y-1.5" disabled={!resume.available || isPending}>
      <legend className="font-medium text-foreground">
        {t("plans.recovery.resume")}
      </legend>
      <p>
        {t("plans.recovery.resumeHint", {
          reused: resume.reusedStepIds
            .map((id) => view.stepNames[id] ?? id)
            .join(", "),
          count: resume.reusedStepIds.length,
        })}
      </p>
      {resume.modes.map((option) => (
        <label
          key={option.mode}
          className="flex items-start gap-2 [@media(pointer:coarse)]:min-h-11"
        >
          <input
            type="radio"
            name={`plan-recovery-mode-${view.runId}`}
            value={option.mode}
            checked={mode === option.mode}
            disabled={!option.available}
            onChange={() => setMode(option.mode)}
          />
          <span>
            {t(`plans.recovery.mode.${option.mode}`)}
            {" – "}
            {t(
              option.available
                ? `plans.recovery.modeHint.${option.mode}`
                : "plans.recovery.modeUnavailable",
            )}
          </span>
        </label>
      ))}
      {resume.reviewStepIds.map((id) => (
        <label
          key={id}
          className="flex items-start gap-2 [@media(pointer:coarse)]:min-h-11"
        >
          <input
            type="checkbox"
            checked={reviewed.includes(id)}
            onChange={(event) => toggle(id, event.target.checked)}
          />
          <span>
            {t("plans.recovery.review", { step: view.stepNames[id] ?? id })}
          </span>
        </label>
      ))}
      <Button
        size="xs"
        variant="outline"
        disabled={!canSubmit}
        onClick={handleResume}
        className="[@media(pointer:coarse)]:h-11"
      >
        {t("plans.recovery.resumeAction")}
      </Button>
    </fieldset>
  );
}
