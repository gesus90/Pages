import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import type { AgentPlanControl } from "@/definition/AgentPlanControl";

const RUN_ACTION_CLASS = "h-9 px-3 text-xs [@media(pointer:coarse)]:min-h-11";
const PLAY_ACTION_CLASS =
  "border-primary bg-primary text-primary-foreground enabled:hover:bg-primary/90";

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
      className="flex flex-wrap items-center gap-1 @2xl:shrink-0 @2xl:flex-nowrap"
      role="group"
      aria-label={t("plans.panel.actions")}
      aria-busy={props.isPending}
    >
      <span title={playHint}>
        <Button
          size="xs"
          variant="outline"
          className={cn(RUN_ACTION_CLASS, PLAY_ACTION_CLASS)}
          aria-label={t("plans.panel.play")}
          disabled={props.isPending || props.isDirty || !control?.canPlay}
          onClick={() => props.onAction("play-plan")}
        >
          {t("plans.panel.play")}
        </Button>
      </span>
      <Button
        size="xs"
        variant="outline"
        className={cn(RUN_ACTION_CLASS, isPaused && PLAY_ACTION_CLASS)}
        aria-label={pauseLabel}
        disabled={
          props.isPending || !(isPaused ? canResume : control?.canPause)
        }
        onClick={() => props.onAction(isPaused ? "resume-plan" : "pause-plan")}
      >
        {pauseLabel}
      </Button>
      <Button
        size="xs"
        variant="outline"
        className={RUN_ACTION_CLASS}
        aria-label={t("plans.panel.stop")}
        disabled={props.isPending || !control?.canStop}
        onClick={() => props.onAction("stop-plan")}
      >
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
