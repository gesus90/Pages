import { Pause, Play, Square } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import type { AgentPlanControl } from "@/definition/AgentPlanControl";

export type PlanRunIntent =
  "play-plan" | "pause-plan" | "resume-plan" | "stop-plan";

/** Separate controls keep starting, draining, continuing and aborting unambiguous. */
export function PlanRunActions(props: {
  readonly control: AgentPlanControl | undefined;
  readonly isReadOnly: boolean;
  readonly isPending: boolean;
  readonly isDirty: boolean;
  readonly hasDeletedFrontier: boolean;
  readonly onAction: (intent: PlanRunIntent) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { control } = props;
  const isPaused = control?.status === "paused";
  const canResume = canContinue(
    control,
    props.isDirty,
    props.hasDeletedFrontier,
  );
  const pauseLabel = isPaused
    ? t("plans.panel.resume")
    : t("plans.panel.pause");
  const playHint = playTitle(props, t);
  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      role="group"
      aria-label={t("plans.panel.actions")}
    >
      <span title={playHint}>
        <Button
          size="sm"
          variant="outline"
          aria-label={t("plans.panel.play")}
          disabled={props.isPending || props.isDirty || !control?.canPlay}
          onClick={() => props.onAction("play-plan")}
        >
          <Play className="size-4" aria-hidden="true" />
          {t("plans.panel.play")}
        </Button>
      </span>
      <Button
        size="sm"
        variant="outline"
        aria-label={pauseLabel}
        disabled={
          props.isPending || !(isPaused ? canResume : control?.canPause)
        }
        onClick={() => props.onAction(isPaused ? "resume-plan" : "pause-plan")}
      >
        {isPaused ? (
          <Play className="size-4" aria-hidden="true" />
        ) : (
          <Pause className="size-4" aria-hidden="true" />
        )}
        {pauseLabel}
      </Button>
      <Button
        size="sm"
        variant="outline"
        aria-label={t("plans.panel.stop")}
        disabled={props.isPending || !control?.canStop}
        onClick={() => props.onAction("stop-plan")}
      >
        <Square className="size-4" aria-hidden="true" />
        {t("plans.panel.stop")}
      </Button>
    </div>
  );
}

function playTitle(
  props: Parameters<typeof PlanRunActions>[0],
  translate: ReturnType<typeof useTranslation>["t"],
): string {
  if (props.isReadOnly) return translate("plans.flow.storage.readOnly");
  if (props.isDirty) return translate("plans.panel.unsaved");
  const control = props.control;
  if (
    control &&
    ["running", "pausing", "paused", "stopping"].includes(control.status)
  )
    return translate("plans.panel.stopFirst");
  return control?.issue
    ? translate(`settings.agents.error.${control.issue}`)
    : translate("plans.panel.newRunHint");
}

function canContinue(
  control: AgentPlanControl | undefined,
  isDirty: boolean,
  hasDeletedFrontier: boolean,
): boolean {
  return Boolean(control?.canResume && !isDirty && !hasDeletedFrontier);
}
