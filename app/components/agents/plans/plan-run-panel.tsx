import { lazy, Suspense, useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { expandPlanGroups } from "@/definition/AgentPlanGroup";
import {
  isActivePlanRun,
  isResumablePlanRunEnd,
} from "@/definition/AgentPlanRunState";
import { ScrollViewport } from "@/app/components/ui/scroll-viewport";

import { keepPlanControlKeys } from "./plan-flow-keys";
import {
  isForeignEndedRun,
  PlanForeignRunStartDialog,
} from "./plan-foreign-run-start-dialog";
import { PlanManagementDialogs } from "./plan-management/plan-management-dialogs";
import { usePlanManagement } from "./plan-management/use-plan-management";
import { PlanPanelDetails } from "./plan-panel-details";
import { PlanPanelHeading } from "./plan-panel-heading";
import { planPanelIssues } from "./plan-panel-issues";
import { PlanPanelStatus } from "./plan-panel-status";
import { planPanelState } from "./plan-panel-status-model";
import { recoverableRunId, recoveryErrorText } from "./plan-recovery-panel";
import { usePlanRecovery } from "./use-plan-recovery";

import type { TFunction } from "i18next";
import type { AgentPlanPage, AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";
import type {
  PlanRecoveryResumeState,
  PlanRunIntent,
} from "./plan-run-actions";
import type { usePlanEditor } from "./use-plan-editor";

// Only a disturbed run asks how to continue; the dialog loads then.
const PlanRecoveryResumeDialog = lazy(async () => ({
  default: (await import("./plan-recovery/plan-recovery-resume-dialog"))
    .PlanRecoveryResumeDialog,
}));

interface PlanRunPanelProps {
  readonly page: AgentPlanPage;
  readonly editor: ReturnType<typeof usePlanEditor>;
  readonly control: AgentPlanControl | undefined;
  /** The run the canvas shows, whose blocked steps the status line names. */
  readonly run: AgentPlanRun | null;
  readonly error: string | null;
  /** Shows a run that a restart or resume started. */
  readonly onRunStarted: (runId: string) => void;
  /** Reads the control again after a recovery decision, which no command reports. */
  readonly onRecoveryDecided: () => void;
}

const RUN_INTENTS: readonly string[] = [
  "play-plan",
  "pause-plan",
  "resume-plan",
  "stop-plan",
];

function isRunIntent(value: unknown): value is PlanRunIntent {
  return typeof value === "string" && RUN_INTENTS.includes(value);
}

/** The run command on its way, which shows its progress on its button. */
function pendingIntent(
  editor: ReturnType<typeof usePlanEditor>,
): PlanRunIntent | null {
  const intent = editor.command.formData?.get("intent");
  return editor.command.state !== "idle" && isRunIntent(intent) ? intent : null;
}

/** Every remaining step of a running run waits behind a failed one. */
function isRunBlocked(run: AgentPlanRun | null): boolean {
  return (
    run?.status === "running" &&
    run.steps.some((step) => step.isBlocked) &&
    !run.steps.some((step) => step.status === "running")
  );
}

function panelPresentation(props: PlanRunPanelProps): {
  readonly hasDeletedFrontier: boolean;
  readonly error: string | null;
  readonly code: string | null;
} {
  const { editor, control } = props;
  const nodes = expandPlanGroups(editor.draft).nodes;
  const hasDeletedFrontier =
    control?.status === "paused" &&
    control.frontierStepIds.some((id) => !nodes.some((node) => node.id === id));
  const result = editor.command.data;
  const error =
    props.error ??
    editor.sourceError ??
    (result?.ok === false && !result.issues?.length ? result.error : null);
  return {
    hasDeletedFrontier,
    error,
    code: hasDeletedFrontier
      ? "plan_continuation_deleted"
      : (control?.issue ?? null),
  };
}

/** Everything that may change the options of the view without being part of it. */
function recoveryReadKey(
  control: AgentPlanControl | undefined,
  planRevision: number | undefined,
): string {
  return JSON.stringify([
    control?.status,
    control?.continuationVersion,
    control?.canPlay,
    control?.canRestart,
    control?.resumeAction,
    planRevision,
  ]);
}

/** Why an ended run cannot be continued while no recovery view is there. */
function missingViewReason(
  control: AgentPlanControl,
  recovery: ReturnType<typeof usePlanRecovery>,
  translate: TFunction,
): string {
  if (!control.canEdit)
    return translate("plans.recovery.blocker.plan_read_only");
  // Without a run identity the newest run belongs to another executor.
  if (control.resumeBlocker === "own_run_required" || !control.runId)
    return translate("plans.recovery.blocker.own_run_required");
  return recovery.error
    ? recoveryErrorText(translate, recovery.error)
    : translate("plans.panel.checking");
}

/**
 * The resume of a failed run as far as the control and the executor's recovery view allow it.
 *
 * @remarks
 * An ended run keeps Fortsetzen in sight also without a view: the control
 * names a run of another executor or missing rights, and an own view that
 * is still loading or was refused names why it waits. Only the view enables it.
 */
function resumeState(
  control: AgentPlanControl | undefined,
  recovery: ReturnType<typeof usePlanRecovery>,
  translate: TFunction,
): PlanRecoveryResumeState | null {
  if (!control || !isResumablePlanRunEnd(control.status)) return null;
  const view = recovery.view;
  if (!view)
    return {
      isAvailable: false,
      reason: missingViewReason(control, recovery, translate),
    };
  // A current blocker of the control, such as a lost execution right, holds back what the view offers.
  const currentBlocker = control.canResume ? null : control.issue;
  return {
    isAvailable:
      view.resume.available && currentBlocker === null && !recovery.isPending,
    reason: resumeReason(view.resume.reason, currentBlocker, translate),
  };
}

/** The translated reason of an unavailable resume: the view's first, then the control's. */
function resumeReason(
  viewReason: string | null,
  currentBlocker: string | null,
  translate: TFunction,
): string | null {
  if (viewReason) return translate(`plans.recovery.blocker.${viewReason}`);
  return currentBlocker
    ? translate([
        `settings.agents.error.${currentBlocker}`,
        "plans.panel.blockedHint",
      ])
    : null;
}

/** The status line of the panel from the server's control state and the draft. */
function panelState(
  props: PlanRunPanelProps,
  actionError: string | null,
  recovery: PlanRecoveryResumeState | null,
): ReturnType<typeof planPanelState> {
  const { editor, page } = props;
  const result = editor.command.data;
  return planPanelState({
    hasPlan: page.selected !== null,
    control: props.control,
    isDirty: editor.isDirty,
    isReadOnly: page.selected?.canEdit === false,
    actionError,
    hasRefusedIssues: result?.ok === false && Boolean(result.issues?.length),
    isRunBlocked: isRunBlocked(props.run),
    recovery,
  });
}

/** Sends a run command for the saved revision; it never carries the draft. */
function submitRunAction(
  props: PlanRunPanelProps,
  intent: PlanRunIntent,
): void {
  void props.editor.command.submit(
    {
      intent,
      planId: props.page.selected?.id ?? "",
      runId: props.control?.runId ?? "",
      revision: String(props.editor.draft.revision ?? ""),
    },
    { method: "post", action: "/agents/plans", flushSync: true },
  );
}

/** The decision a run action asks for before anything is sent. */
type PlanRunDecision = "restart" | "resume" | "foreign-start";

/** Asks for the restart or resume of an own run, or confirms a new run beside another executor's. */
function PlanRunDecisionDialog({
  action,
  recovery,
  onStart,
  onClose,
}: {
  readonly action: PlanRunDecision | null;
  readonly recovery: ReturnType<typeof usePlanRecovery>;
  readonly onStart: () => void;
  readonly onClose: () => void;
}): React.ReactElement | null {
  if (action === "foreign-start")
    return <PlanForeignRunStartDialog onConfirm={onStart} onClose={onClose} />;
  if (!action) return null;
  return (
    <Suspense fallback={null}>
      <PlanRecoveryResumeDialog
        recovery={recovery}
        action={action}
        onClose={onClose}
      />
    </Suspense>
  );
}

/** Fixed within the editor, independent of graph position, viewport and zoom. */
export function PlanRunPanel(props: PlanRunPanelProps): React.ReactElement {
  const { t } = useTranslation();
  const detailsId = useId();
  const [isOpen, setOpen] = useState(false);
  const [recoveryAction, setRecoveryAction] = useState<PlanRunDecision | null>(
    null,
  );
  const { editor, control, page } = props;
  const management = usePlanManagement();
  const recoveryRunId =
    page.selected?.canEdit === false ? null : recoverableRunId(control);
  const recovery = usePlanRecovery(recoveryRunId, props.onRunStarted, {
    isRunActive: control !== undefined && isActivePlanRun(control.status),
    readKey: recoveryReadKey(control, page.selected?.revision),
    onDecided: props.onRecoveryDecided,
  });
  const presentation = panelPresentation(props);
  const recoveryResume = resumeState(control, recovery, t);
  const state = panelState(props, presentation.error, recoveryResume);
  function action(intent: PlanRunIntent): void {
    if (intent === "play-plan" && control?.canRestart)
      setRecoveryAction("restart");
    else if (intent === "play-plan" && isForeignEndedRun(control))
      setRecoveryAction("foreign-start");
    else submitRunAction(props, intent);
  }
  return (
    <>
      <ScrollViewport
        as="section"
        axis="vertical"
        aria-label={t("plans.panel.label")}
        data-plan-panel
        onKeyDown={keepPlanControlKeys}
        containerClassName="min-h-0 w-full overflow-hidden rounded-xl border border-border bg-surface text-foreground shadow-floating"
        className="pointer-events-auto @container/plan-panel overflow-y-auto rounded-[inherit]"
        fadeClassName="hidden"
      >
        <PlanPanelHeading
          page={page}
          editor={editor}
          control={control}
          isPending={
            recovery.isPending ||
            editor.isPending ||
            Boolean(props.error) ||
            (!control && page.selected !== null)
          }
          pendingIntent={pendingIntent(editor)}
          hasDeletedFrontier={presentation.hasDeletedFrontier}
          recovery={recoveryResume}
          isOpen={isOpen}
          detailsId={detailsId}
          onToggle={() => setOpen(!isOpen)}
          onAction={action}
          onRecover={() => setRecoveryAction("resume")}
          onManage={management.open}
        />
        <PlanPanelStatus
          state={state}
          isOpen={isOpen}
          detailsId={detailsId}
          onToggle={() => setOpen(!isOpen)}
        />
        {isOpen ? (
          <PlanPanelDetails
            id={detailsId}
            page={page}
            editor={editor}
            control={control}
            run={props.run}
            issues={planPanelIssues({
              control,
              editor,
              code: presentation.code,
              translate: t,
            })}
            error={presentation.error}
          />
        ) : null}
      </ScrollViewport>
      <PlanRunDecisionDialog
        action={recoveryAction}
        recovery={recovery}
        onStart={() => submitRunAction(props, "play-plan")}
        onClose={() => setRecoveryAction(null)}
      />
      <PlanManagementDialogs
        page={page}
        editor={editor}
        management={management}
      />
    </>
  );
}
