import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { expandPlanGroups } from "@/definition/AgentPlanGroup";
import { ScrollViewport } from "@/app/components/ui/scroll-viewport";

import { keepPlanControlKeys } from "./plan-flow-keys";
import { PlanManagementDialogs } from "./plan-management/plan-management-dialogs";
import { usePlanManagement } from "./plan-management/use-plan-management";
import { PlanPanelDetails } from "./plan-panel-details";
import { PlanPanelHeading } from "./plan-panel-heading";
import { planPanelIssues } from "./plan-panel-issues";
import { PlanPanelStatus } from "./plan-panel-status";
import { planPanelState } from "./plan-panel-status-model";
import { recoverableRunId } from "./plan-recovery-panel";
import { PlanRecoveryResumeDialog } from "./plan-recovery/plan-recovery-resume-dialog";
import { usePlanRecovery } from "./use-plan-recovery";

import type { TFunction } from "i18next";
import type { AgentPlanPage, AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";
import type {
  PlanRecoveryResumeState,
  PlanRunIntent,
} from "./plan-run-actions";
import type { usePlanEditor } from "./use-plan-editor";

interface PlanRunPanelProps {
  readonly page: AgentPlanPage;
  readonly editor: ReturnType<typeof usePlanEditor>;
  readonly control: AgentPlanControl | undefined;
  /** The run the canvas shows, whose blocked steps the status line names. */
  readonly run: AgentPlanRun | null;
  readonly error: string | null;
  /** Shows a run that a restart or resume started. */
  readonly onRunStarted: (runId: string) => void;
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

/** The resume of a failed run as far as the executor's recovery view allows it. */
function resumeState(
  control: AgentPlanControl | undefined,
  recovery: ReturnType<typeof usePlanRecovery>,
  translate: TFunction,
): PlanRecoveryResumeState | null {
  const view = recovery.view;
  if (control?.status !== "failed" || !view) return null;
  return {
    isAvailable: view.resume.available && !recovery.isPending,
    reason: view.resume.reason
      ? translate(`plans.recovery.blocker.${view.resume.reason}`)
      : null,
  };
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

/** Fixed within the editor, independent of graph position, viewport and zoom. */
export function PlanRunPanel(props: PlanRunPanelProps): React.ReactElement {
  const { t } = useTranslation();
  const detailsId = useId();
  const [isOpen, setOpen] = useState(false);
  const [isResuming, setResuming] = useState(false);
  const { editor, control, page } = props;
  const management = usePlanManagement();
  const recoveryRunId =
    page.selected?.canEdit === false ? null : recoverableRunId(control);
  const recovery = usePlanRecovery(recoveryRunId, props.onRunStarted);
  const presentation = panelPresentation(props);
  const recoveryResume = resumeState(control, recovery, t);
  const state = panelState(props, presentation.error, recoveryResume);
  function action(intent: PlanRunIntent): void {
    submitRunAction(props, intent);
  }
  return (
    <>
      <ScrollViewport
        as="section"
        axis="vertical"
        aria-label={t("plans.panel.label")}
        data-plan-panel
        onKeyDown={keepPlanControlKeys}
        containerClassName="min-h-0 w-full overflow-hidden rounded-xl"
        className="pointer-events-auto overflow-y-auto rounded-xl border border-border bg-surface/95 text-foreground shadow-panel backdrop-blur-sm"
      >
        <PlanPanelHeading
          page={page}
          editor={editor}
          control={control}
          isPending={
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
          onRecover={() => setResuming(true)}
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
            issues={planPanelIssues({
              control,
              editor,
              code: presentation.code,
              translate: t,
            })}
            error={presentation.error}
            recoveryRunId={recoveryRunId}
            recovery={recovery}
          />
        ) : null}
      </ScrollViewport>
      {isResuming ? (
        <PlanRecoveryResumeDialog
          recovery={recovery}
          onClose={() => setResuming(false)}
        />
      ) : null}
      <PlanManagementDialogs
        page={page}
        editor={editor}
        management={management}
      />
    </>
  );
}
