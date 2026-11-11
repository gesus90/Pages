import { Loader2, Pause, Play, Square } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import type { TFunction } from "i18next";
import type {
  AgentPlanControl,
  AgentPlanResumeBlock,
} from "@/definition/AgentPlanControl";

const RUN_ACTION_CLASS =
  "h-9 w-full min-w-0 justify-center gap-1.5 px-3 text-xs font-semibold xl:text-xs [@media(pointer:coarse)]:min-h-11";
const PRIMARY_ACTION_CLASS =
  "border-primary bg-primary text-primary-foreground enabled:hover:bg-primary/90";

export type PlanRunIntent =
  "play-plan" | "pause-plan" | "resume-plan" | "stop-plan";

interface PlanRunActionsProps {
  readonly control: AgentPlanControl | undefined;
  readonly isReadOnly: boolean;
  /** A request of the panel is on its way, or the state is not known. */
  readonly isPending: boolean;
  /** The intent of the request on its way, which shows its progress. */
  readonly pendingIntent: PlanRunIntent | null;
  readonly isDirty: boolean;
  readonly hasDeletedFrontier: boolean;
  readonly onAction: (intent: PlanRunIntent) => void;
}

/** What the middle button does: drain a running run, or continue whatever can be continued. */
type MiddleMode = "pause" | "resume";

/** Fortsetzen stands for every state of {@link AgentPlanControl.resumeKind}; the server picks the way. */
function middleMode(props: PlanRunActionsProps): MiddleMode {
  const { control } = props;
  return control?.resumeKind || control?.status === "paused"
    ? "resume"
    : "pause";
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
 * Fortsetzen replaces Pause while a run can be continued, whether it is paused,
 * failed, interrupted, blocked, stopped or has only its closeout open; one
 * click is enough, because the server chooses the technical way. Stop stays
 * available while a stop hangs, where it ends the run's processes by force.
 * The buttons only mirror the server's answer: every action is checked again
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
      className="inline-grid min-w-0 max-w-full grid-cols-2 gap-1 @sm/plan-panel:grid-cols-[repeat(3,minmax(max-content,1fr))]"
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
          disabled={props.isPending || !control?.canStop}
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
  }[mode];
  const isBusy =
    control?.status === "pausing" ||
    props.pendingIntent === "pause-plan" ||
    props.pendingIntent === "resume-plan";
  function handleClick(): void {
    props.onAction(mode === "resume" ? "resume-plan" : "pause-plan");
  }
  return (
    <span title={middleTitle(props, mode, t)} className="flex">
      <Button
        size="xs"
        variant="outline"
        className={cn(
          RUN_ACTION_CLASS,
          // A paused run has only this way forward; after a failure Starten stays the primary action.
          control?.status === "paused" && isEnabled && PRIMARY_ACTION_CLASS,
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
  if (
    !control.canPlay &&
    ["running", "pausing", "paused", "stopping"].includes(control.status)
  )
    return translate("plans.panel.stopFirst");
  if (control.runId) return translate("plans.recovery.freshDescription");
  if (control.resumeBlocker === "own_run_required")
    return translate("plans.panel.foreignRunHint");
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
  if (mode === "resume") {
    if (props.isDirty) return translate("plans.panel.unsaved");
    if (props.hasDeletedFrontier)
      return translate("settings.agents.error.plan_continuation_deleted");
    if (control?.resumeBlock && !control.canResume)
      return resumeBlockText(control.resumeBlock, translate);
    if (control?.issue && !control.canResume)
      return translate(`settings.agents.error.${control.issue}`);
    return control?.resumeBlocker
      ? translate(`plans.recovery.blocker.${control.resumeBlocker}`)
      : translate(`plans.panel.resumeHint`, {
          context: control?.resumeKind,
        });
  }
  if (control?.status === "pausing")
    return translate("plans.panel.pausingHint");
  return translate("plans.panel.pauseHint");
}

/** The reason of a block and what to do about it, as one sentence. */
export function resumeBlockText(
  block: AgentPlanResumeBlock,
  translate: TFunction,
): string {
  const reason = translate(
    [
      `plans.resumeBlock.reason.${block.code}`,
      `plans.recovery.blocker.${block.code}`,
      `settings.agents.error.${block.code}`,
    ],
    { defaultValue: translate("plans.resumeBlock.reason.unknown") },
  );
  return `${reason} ${translate(`plans.resumeBlock.next.${block.action}`)}`;
}

function stopTitle(props: PlanRunActionsProps, translate: TFunction): string {
  if (props.control?.status === "stopping")
    return translate("plans.panel.stoppingHint");
  return translate("plans.panel.stopHint");
}
