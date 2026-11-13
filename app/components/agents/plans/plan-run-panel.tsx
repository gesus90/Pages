import { lazy, Suspense, useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { expandPlanGroups } from "@/definition/AgentPlanGroup";
import { isActivePlanRun } from "@/definition/AgentPlanRunState";
import { ScrollViewport } from "@/app/components/ui/scroll-viewport";

import { keepPlanControlKeys } from "./plan-flow-keys";
import {
  isForeignEndedRun,
  PlanForeignRunStartDialog,
} from "./plan-foreign-run-start-dialog";
import { PlanManagementDialogs } from "./plan-management/plan-management-dialogs";
import { PlanOpenRunStartDialog } from "./plan-open-run-start-dialog";
import { usePlanManagement } from "./plan-management/use-plan-management";
import { PlanPanelDetails } from "./plan-panel-details";
import { PlanPanelHeading } from "./plan-panel-heading";
import { planPanelIssues } from "./plan-panel-issues";
import { PlanPanelStatus } from "./plan-panel-status";
import { planPanelState } from "./plan-panel-status-model";
import { recoverableRunId, recoveryErrorText } from "./plan-recovery-panel";
import { usePlanRecovery } from "./use-plan-recovery";

import type { AgentPlanPage, AgentPlanRun } from "@/definition/AgentPlan";
import type {
  AgentPlanControl,
  AgentPlanResumeAction,
} from "@/definition/AgentPlanControl";
import type { PlanRunIntent } from "./plan-run-actions";
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

/** The status line of the panel from the server's control state and the draft. */
function panelState(
  props: PlanRunPanelProps,
  actionError: string | null,
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
  });
}

/** Sends a run command for the saved revision; it never carries the draft. */
function submitRunAction(
  props: PlanRunPanelProps,
  intent: PlanRunIntent,
  replacesOpenRun = false,
): void {
  void props.editor.command.submit(
    {
      intent,
      planId: props.page.selected?.id ?? "",
      runId: props.control?.runId ?? "",
      revision: String(props.editor.draft.revision ?? ""),
      ...(replacesOpenRun ? { replaceOpenRun: "true" } : {}),
    },
    { method: "post", action: "/agents/plans", flushSync: true },
  );
}

/** The decision a run action asks for before anything is sent. */
type PlanRunDecision = "restart" | "foreign-start" | "replace-open";

/**
 * Asks for the restart of an ended run, confirms that an open run ends for a new one,
 * or confirms a new run beside another executor's.
 */
function PlanRunDecisionDialog({
  action,
  recovery,
  planName,
  onStart,
  onClose,
}: {
  readonly planName: string;
  readonly action: PlanRunDecision | null;
  readonly recovery: ReturnType<typeof usePlanRecovery>;
  readonly onStart: () => void;
  readonly onClose: () => void;
}): React.ReactElement | null {
  if (action === "foreign-start")
    return <PlanForeignRunStartDialog onConfirm={onStart} onClose={onClose} />;
  if (action === "replace-open")
    return <PlanOpenRunStartDialog onConfirm={onStart} onClose={onClose} />;
  if (!action) return null;
  return (
    <Suspense fallback={null}>
      <PlanRecoveryResumeDialog recovery={recovery} planName={planName} onClose={onClose} />
    </Suspense>
  );
}

/** Switches the signed-in administrator to the active admin mode, which script steps need. */
async function switchToAdminMode(): Promise<void> {
  const body = new FormData();
  body.set("intent", "admin-mode");
  await fetch("/agents/plans", { method: "POST", body, cache: "no-store" });
}

/** The refusal of the last recovery request, such as a release that could not be confirmed. */
function RecoveryErrorLine({
  recovery,
}: {
  readonly recovery: ReturnType<typeof usePlanRecovery>;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (!recovery.error) return null;
  return (
    <p role="alert" className="px-4 pt-2 text-xs text-destructive">
      {recoveryErrorText(
        t,
        recovery.error,
        recovery.cleanupFailure,
        recovery.view?.stepNames,
      )}
    </p>
  );
}

/** What the run buttons and the action of a block do; each may first ask for a decision. */
function useRunDecisions(
  props: PlanRunPanelProps,
  recovery: ReturnType<typeof usePlanRecovery>,
): {
  readonly recoveryAction: PlanRunDecision | null;
  readonly setRecoveryAction: (action: PlanRunDecision | null) => void;
  readonly action: (intent: PlanRunIntent) => void;
  readonly resolveBlock: (action: AgentPlanResumeAction) => void;
} {
  const [recoveryAction, setRecoveryAction] = useState<PlanRunDecision | null>(
    null,
  );
  const { control } = props;
  function action(intent: PlanRunIntent): void {
    if (intent !== "play-plan") submitRunAction(props, intent);
    else if (control?.runId && isActivePlanRun(control.status))
      setRecoveryAction("replace-open");
    else if (control?.canRestart) setRecoveryAction("restart");
    else if (isForeignEndedRun(control)) setRecoveryAction("foreign-start");
    else submitRunAction(props, "play-plan");
  }
  function resolveBlock(blockAction: AgentPlanResumeAction): void {
    if (blockAction === "restart") setRecoveryAction("restart");
    else if (blockAction === "release")
      void recovery.submit({ action: "release" });
    else if (blockAction === "admin_mode")
      void switchToAdminMode().then(props.onRecoveryDecided);
  }
  return { recoveryAction, setRecoveryAction, action, resolveBlock };
}

/** Fixed within the editor, independent of graph position, viewport and zoom. */
export function PlanRunPanel(props: PlanRunPanelProps): React.ReactElement {
  const { t } = useTranslation();
  const detailsId = useId();
  const [isOpen, setOpen] = useState(false);
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
  const state = panelState(props, presentation.error);
  const { recoveryAction, setRecoveryAction, action, resolveBlock } =
    useRunDecisions(props, recovery);
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
          isOpen={isOpen}
          detailsId={detailsId}
          onToggle={() => setOpen(!isOpen)}
          onAction={action}
          onResolveBlock={resolveBlock}
          onManage={management.open}
        />
        {recoveryRunId ? <RecoveryErrorLine recovery={recovery} /> : null}
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
        planName={page.selected?.name ?? ""}
        onStart={() =>
          submitRunAction(props, "play-plan", recoveryAction === "replace-open")
        }
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
