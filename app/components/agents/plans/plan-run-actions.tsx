import { Pause, Play, Square } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import type { AgentPlanControl } from "@/definition/AgentPlanControl";

const RUN_ACTION_CLASS =
  "gap-[5px] px-[9px] text-[11px] disabled:opacity-45 xl:gap-[5px] xl:px-[9px] xl:text-[11px] [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-h-11";
const PLAY_ACTION_CLASS =
  "border-[color-mix(in_srgb,var(--color-success)_35%,var(--color-border))] bg-success-subtle text-success enabled:hover:bg-[color-mix(in_srgb,var(--color-success)_4%,var(--color-success-subtle))] focus-visible:outline-success";
const PAUSE_ACTION_CLASS =
  "border-[color-mix(in_srgb,var(--color-warning)_35%,var(--color-border))] bg-warning-subtle text-warning enabled:hover:bg-[color-mix(in_srgb,var(--color-warning)_4%,var(--color-warning-subtle))] focus-visible:outline-warning";
const STOP_ACTION_CLASS =
  "border-[color-mix(in_srgb,var(--color-destructive)_35%,var(--color-border))] bg-destructive-subtle text-destructive enabled:hover:bg-[color-mix(in_srgb,var(--color-destructive)_4%,var(--color-destructive-subtle))] focus-visible:outline-destructive";

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
      className="flex flex-wrap items-center gap-1 @2xl:shrink-0 @2xl:flex-nowrap @2xl:border-l @2xl:border-border @2xl:pl-2.5"
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
          <Play className="size-3.5" aria-hidden="true" />
          {t("plans.panel.play")}
        </Button>
      </span>
      <Button
        size="xs"
        variant="outline"
        className={cn(
          RUN_ACTION_CLASS,
          isPaused ? PLAY_ACTION_CLASS : PAUSE_ACTION_CLASS,
        )}
        aria-label={pauseLabel}
        disabled={
          props.isPending || !(isPaused ? canResume : control?.canPause)
        }
        onClick={() => props.onAction(isPaused ? "resume-plan" : "pause-plan")}
      >
        {isPaused ? (
          <Play className="size-3.5" aria-hidden="true" />
        ) : (
          <Pause className="size-3.5" aria-hidden="true" />
        )}
        {pauseLabel}
      </Button>
      <Button
        size="xs"
        variant="outline"
        className={cn(RUN_ACTION_CLASS, STOP_ACTION_CLASS)}
        aria-label={t("plans.panel.stop")}
        disabled={props.isPending || !control?.canStop}
        onClick={() => props.onAction("stop-plan")}
      >
        <Square className="size-3.5" aria-hidden="true" />
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
