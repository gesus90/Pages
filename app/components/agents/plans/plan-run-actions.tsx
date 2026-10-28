import { Loader2, Pause, Play, Square } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import type { TFunction } from "i18next";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";

const RUN_ACTION_CLASS =
  "h-9 w-full min-w-0 justify-center gap-1.5 px-3 text-xs font-semibold xl:text-xs [@media(pointer:coarse)]:min-h-11";
const PRIMARY_ACTION_CLASS =
  "border-primary bg-primary text-primary-foreground enabled:hover:bg-primary/90";

export type PlanRunIntent =
  "play-plan" | "pause-plan" | "resume-plan" | "stop-plan";

/** The resume of a run that ended at a failure, as far as its executor may take it. */
export interface PlanRecoveryResumeState {
  readonly isAvailable: boolean;
  /** Why it is not available, as a translated sentence; `null` when it is. */
  readonly reason: string | null;
}

interface PlanRunActionsProps {
  readonly control: AgentPlanControl | undefined;
  readonly isReadOnly: boolean;
  /** A request of the panel is on its way, or the state is not known. */
  readonly isPending: boolean;
  /** The intent of the request on its way, which shows its progress. */
  readonly pendingIntent: PlanRunIntent | null;
  readonly isDirty: boolean;
  readonly hasDeletedFrontier: boolean;
  /** Present while the newest run ended at a failure that its executor sees. */
  readonly recovery: PlanRecoveryResumeState | null;
  readonly onAction: (intent: PlanRunIntent) => void;
  /** Opens the decision how an ended run continues. */
  readonly onRecover: () => void;
}

/** What the middle button does: drain a running run, continue a paused one, or continue an ended one. */
type MiddleMode = "pause" | "resume" | "recover";

function middleMode(props: PlanRunActionsProps): MiddleMode {
  if (props.control?.status === "paused") return "resume";
  if (props.control?.status === "failed" && props.recovery) return "recover";
  return "pause";
}

/**
 * Icon and label, centred in the space of the widest label.
 *
 * @remarks
 * An invisible copy of the widest label shares the grid cell, so every
 * button keeps one width whatever it says, also while it shows progress.
 */
function ActionContent({
  icon: Icon,
  isBusy,
  label,
  widest,
}: {
  readonly icon: typeof Play;
  readonly isBusy: boolean;
  readonly label: string;
  readonly widest: string;
}): React.ReactElement {
  return (
    <span className="grid place-items-center">
      <span className="col-start-1 row-start-1 flex items-center gap-1.5">
        {isBusy ? (
          <Loader2
            aria-hidden="true"
            className="size-3.5 shrink-0 animate-spin"
          />
        ) : (
          <Icon aria-hidden="true" className="size-3.5 shrink-0" />
        )}
        {label}
      </span>
      <span
        aria-hidden="true"
        className="invisible col-start-1 row-start-1 flex items-center gap-1.5"
      >
        <Icon className="size-3.5 shrink-0" />
        {widest}
      </span>
    </span>
  );
}

/**
 * Starten, Pause or Fortsetzen, and Stop, in this order and of one width.
 *
 * @remarks
 * Starten starts a new run of the saved revision and nothing else; Pause lets
 * running steps finish and dispatches nothing new; Stop ends the whole run.
 * Fortsetzen replaces Pause while a run is paused or ended at a failure. The
 * buttons only mirror the server's answer: every action is checked again
 * when it arrives.
 */
export function PlanRunActions(props: PlanRunActionsProps): React.ReactElement {
  const { t } = useTranslation();
  const { control } = props;
  const status = control?.status ?? "idle";
  const widest = t("plans.panel.resume");
  const isSettling = status === "pausing" || status === "stopping";
  return (
    <div
      className="inline-grid shrink-0 grid-cols-[repeat(3,minmax(max-content,1fr))] gap-1"
      role="group"
      aria-label={t("plans.panel.actions")}
      aria-busy={props.isPending || isSettling}
    >
      <span title={playTitle(props, t)} className="flex">
        <Button
          size="xs"
          variant="outline"
          className={cn(RUN_ACTION_CLASS, PRIMARY_ACTION_CLASS)}
          disabled={props.isPending || props.isDirty || !control?.canPlay}
          onClick={() => props.onAction("play-plan")}
        >
          <ActionContent
            icon={Play}
            isBusy={props.pendingIntent === "play-plan"}
            label={t("plans.panel.play")}
            widest={widest}
          />
        </Button>
      </span>
      <PlanMiddleAction {...props} widest={widest} />
      <span title={stopTitle(props, t)} className="flex">
        <Button
          size="xs"
          variant="outline"
          className={RUN_ACTION_CLASS}
          disabled={
            props.isPending || status === "stopping" || !control?.canStop
          }
          onClick={() => props.onAction("stop-plan")}
        >
          <ActionContent
            icon={Square}
            isBusy={
              props.pendingIntent === "stop-plan" || status === "stopping"
            }
            label={t("plans.panel.stop")}
            widest={widest}
          />
        </Button>
      </span>
    </div>
  );
}

/** Pause, or Fortsetzen in its place while there is something to continue. */
function PlanMiddleAction(
  props: PlanRunActionsProps & { readonly widest: string },
): React.ReactElement {
  const { t } = useTranslation();
  const mode = middleMode(props);
  const control = props.control;
  const isEnabled = {
    pause: Boolean(control?.canPause),
    resume:
      Boolean(control?.canResume) &&
      !props.isDirty &&
      !props.hasDeletedFrontier,
    recover: props.recovery?.isAvailable === true,
  }[mode];
  const isBusy =
    control?.status === "pausing" ||
    props.pendingIntent === "pause-plan" ||
    props.pendingIntent === "resume-plan";
  function handleClick(): void {
    if (mode === "recover") props.onRecover();
    else props.onAction(mode === "resume" ? "resume-plan" : "pause-plan");
  }
  return (
    <span title={middleTitle(props, mode, t)} className="flex">
      <Button
        size="xs"
        variant="outline"
        className={cn(
          RUN_ACTION_CLASS,
          // A paused run has only this way forward; after a failure Starten stays the primary action.
          mode === "resume" && isEnabled && PRIMARY_ACTION_CLASS,
        )}
        disabled={props.isPending || !isEnabled}
        onClick={handleClick}
      >
        <ActionContent
          icon={mode === "pause" ? Pause : Play}
          isBusy={isBusy}
          label={t(
            mode === "pause" ? "plans.panel.pause" : "plans.panel.resume",
          )}
          widest={props.widest}
        />
      </Button>
    </span>
  );
}

function playTitle(props: PlanRunActionsProps, translate: TFunction): string {
  if (props.isReadOnly) return translate("plans.flow.storage.readOnly");
  if (props.isDirty) return translate("plans.panel.unsaved");
  const control = props.control;
  if (!control) return translate("plans.panel.checking");
  if (["running", "pausing", "paused", "stopping"].includes(control.status))
    return translate("plans.panel.stopFirst");
  if (control.issue === "plan_workspace_conflict")
    return translate("settings.agents.error.plan_workspace_conflict");
  return control.issue || control.issues?.length
    ? translate("plans.panel.blockedHint")
    : translate("plans.panel.newRunHint");
}

function middleTitle(
  props: PlanRunActionsProps,
  mode: MiddleMode,
  translate: TFunction,
): string {
  const control = props.control;
  if (mode === "recover")
    return props.recovery?.reason ?? translate("plans.panel.recoverHint");
  if (mode === "resume") {
    if (props.isDirty) return translate("plans.panel.unsaved");
    if (props.hasDeletedFrontier)
      return translate("settings.agents.error.plan_continuation_deleted");
    return control?.issue
      ? translate(`settings.agents.error.${control.issue}`)
      : translate("plans.panel.resumeHint");
  }
  if (control?.status === "pausing")
    return translate("plans.panel.pausingHint");
  return translate("plans.panel.pauseHint");
}

function stopTitle(props: PlanRunActionsProps, translate: TFunction): string {
  if (props.control?.status === "stopping")
    return translate("plans.panel.stoppingHint");
  return translate("plans.panel.stopHint");
}
