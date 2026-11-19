import { CloudOff, LoaderCircle } from "lucide-react";
import { lazy, Suspense, useEffect, useEffectEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useBlocker,
  useFetcher,
  useRevalidator,
  useSearchParams,
} from "react-router";

import { useRegionFormatter } from "@/app/components/common/region-provider";
import { AgentDiscardDialog } from "@/app/components/settings/agents/agent-discard-dialog";
import { Button } from "@/app/components/ui/button";
import { DEFAULT_PLAN_NAME } from "@/app/lib/agent-plan-default";
import { cn } from "@/app/lib/cn";
import { isPlanEditLocked } from "@/definition/AgentPlanRunState";
import { planTargetDeviations } from "@/definition/AgentPlanTarget";

import { PlanRunPanel } from "./plan-run-panel";
import { sequencedRun } from "./plan-run-status-model";
import { PlanCanvas } from "./plan-canvas";
import {
  PlanIncomingRevision,
  PlanRevisionConflict,
} from "./plan-revision-conflict";
import { PlanSaveNotice } from "./plan-save-notice";
import { usePlanEditor } from "./use-plan-editor";
import { usePlanPoll } from "./use-plan-poll";
import { usePlanRun } from "./use-plan-run";
import { usePlanSave } from "./use-plan-save";
import { planWorkspaceWait } from "./plan-workspace-wait-model";

import type { AgentPlanOpening } from "@/app/lib/agent-plan-default";
import type { AgentPlanActionResult } from "@/app/lib/agent-plan-response";
import type { LocalStateMark } from "@/app/lib/local-state/local-state-loader";
import type {
  AgentPlanInput,
  AgentPlanPage,
  AgentPlanRun,
  AgentPlanRunSummary,
} from "@/definition/AgentPlan";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";
import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";

// Opened only on request, so the page loads without their code.
const PlanAgentConsole = lazy(async () => ({
  default: (await import("./plan-agent-console")).PlanAgentConsole,
}));
const PlanNodeDialog = lazy(async () => ({
  default: (await import("./plan-node-dialog")).PlanNodeDialog,
}));

interface PlanRunDisplay {
  readonly run: AgentPlanRun | null;
  /** The saved plan when it is the revision the run executes. */
  readonly plan?: AgentPlanInput;
  readonly error: string | null;
}

function parameterWorkspaces(
  page: AgentPlanPage,
  draft: AgentPlanInput,
): readonly AgentWorkspaceChoice[] {
  const projectId = page.workspaces.find(
    (workspace) => workspace.id === draft.workspaceId,
  )?.projectId;
  const hasRemoteTarget =
    draft.executionTarget?.kind === "remote" ||
    planTargetDeviations(draft, draft.executionTarget).some(
      (node) => node.executionTarget?.kind === "remote",
    );
  return page.workspaces.filter(
    (workspace) =>
      workspace.projectId === projectId &&
      (workspace.kind !== "remote" || hasRemoteTarget),
  );
}

/** The saved plan when it is the revision the run executes, so the run is read against its own graph. */
function executedPlan(
  page: AgentPlanPage,
  run: AgentPlanRun | null,
): AgentPlanInput | undefined {
  const revision = run?.continuation?.planRevision ?? run?.planRevision;
  return page.selected?.revision === revision
    ? (page.selected ?? undefined)
    : undefined;
}

function planRunDisplay(
  page: AgentPlanPage,
  control: AgentPlanControl | undefined,
  running: ReturnType<typeof usePlanRun>,
): PlanRunDisplay {
  const run = sequencedRun(
    running.run?.planId === page.selected?.id ? running.run : null,
    page.selected,
  );
  let error = running.error;
  // Shared control metadata never grants access to the executor's run details.
  if (!error && page.selected?.canEdit === false && control?.runId && !run)
    error = "plan_run_unavailable";
  return { run, error, plan: executedPlan(page, run) };
}

/** Whether the saved plan may start now; `undefined` while the server has not answered. */
function planReadiness(
  control: AgentPlanControl | undefined,
  isDirty: boolean,
): boolean | undefined {
  return control ? control.canPlay && !isDirty : undefined;
}

/**
 * The canvas stays editable while a save runs; other pending commands lock it.
 * @remarks
 * Edits made during a save stay unsaved on top of the revision that save
 * stores, and the next save carries them. An existing drag may also finish
 * while the sources of a new workspace load.
 */
function canEditCanvas(editor: ReturnType<typeof usePlanEditor>): boolean {
  if (!editor.canEdit || !editor.draft.workspaceId) return false;
  if (!editor.isPending) return true;
  if (editor.isSaving && !editor.isLoadingSources) return true;
  return (
    editor.command.formData?.get("intent") === "save-plan" &&
    editor.graph.isMoving
  );
}

/** The right to edit is not enough: while a run executes steps, the server refuses every change. */
function canEditPlan(
  canEdit: boolean,
  controls: ReturnType<typeof usePlanControl>,
  localState: LocalStateMark | undefined,
): boolean {
  return (
    canEdit &&
    !localState &&
    (!controls.error || controls.error === "plan_connection_unavailable") &&
    (controls.control?.canEdit ?? true) &&
    !isPlanEditLocked(controls.control?.status ?? "idle")
  );
}

/** Restores keyboard focus to the console's node without panning the canvas. */
function focusConsoleNode(nodeId: string | null): void {
  // Focus returns to the node that opened the console, without moving the canvas.
  if (nodeId)
    document
      .querySelector<HTMLElement>(`[data-plan-handle="${CSS.escape(nodeId)}"]`)
      ?.focus({ preventScroll: true });
}

interface PlanPanelsState {
  readonly editingNodeId: string | null;
  readonly consoleNodeId: string | null;
  readonly onEdit: (id: string | null) => void;
  readonly onOpen: (id: string | null) => void;
  readonly onCloseEditing: () => void;
  readonly onCloseConsole: () => void;
}

function usePlanPanels(): PlanPanelsState {
  const [editingNodeId, onEdit] = useState<string | null>(null);
  const [consoleNodeId, onOpen] = useState<string | null>(null);
  return {
    editingNodeId,
    consoleNodeId,
    onEdit,
    onOpen,
    onCloseEditing: () => onEdit(null),
    onCloseConsole: () => {
      onOpen(null);
      focusConsoleNode(consoleNodeId);
    },
  };
}

function PlanEditorTitle(props: {
  readonly name?: string;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <h1 className="sr-only">
      {props.name ? `${t("plans.title")} · ${props.name}` : t("plans.title")}
    </h1>
  );
}

/**
 * The plan editor: one canvas over the whole content area beside the navigation.
 *
 * @remarks
 * The canvas runs from the global header to the bottom of the window and
 * shows nodes, connections and the zoom bar beneath a floating run panel.
 * The node dialog and agent console appear only when requested; Ctrl+S or
 * Cmd+S saves. Run updates never remount the canvas. A page from the
 * browser's local state is read only until the server answers.
 */
export function PlanPage({
  page,
  opening,
  localState,
}: {
  readonly page: AgentPlanPage;
  readonly opening: AgentPlanOpening;
  readonly localState?: LocalStateMark;
}): React.ReactElement {
  // The models come complete with the page; using a model choice reloads nothing.
  return (
    <PlanEditorPage page={page} opening={opening} localState={localState} />
  );
}

/** The node dialog and the console, each loaded when it opens. */
function PlanOnDemandPanels(props: {
  readonly editingNodeId: string | null;
  readonly consoleNodeId: string | null;
  readonly editor: ReturnType<typeof usePlanEditor>;
  readonly run: AgentPlanRun | null;
  readonly running: ReturnType<typeof usePlanRun>;
  readonly onCloseEditing: () => void;
  readonly onCloseConsole: () => void;
}): React.ReactElement {
  const { editor } = props;
  return (
    <Suspense fallback={null}>
      {props.editingNodeId ? (
        <PlanNodeDialog
          nodeId={props.editingNodeId}
          editor={editor}
          run={props.run}
          onClose={props.onCloseEditing}
        />
      ) : null}
      {props.consoleNodeId ? (
        <PlanAgentConsole
          nodeId={props.consoleNodeId}
          draft={editor.draft}
          sources={editor.sources}
          running={props.running}
          onClose={props.onCloseConsole}
        />
      ) : null}
    </Suspense>
  );
}

/** The notices above the canvas: where the shown state comes from and how a save went. */
function PlanStatusNotices(props: {
  readonly saving: ReturnType<typeof usePlanSave>;
  readonly editor: ReturnType<typeof usePlanEditor>;
  readonly localState?: LocalStateMark;
}): React.ReactElement {
  return (
    <>
      <PlanLocalStateNotice mark={props.localState} />
      <PlanIncomingRevision editor={props.editor} />
      <PlanSaveNotice
        feedback={props.saving.feedback}
        onDismiss={props.saving.dismiss}
      />
    </>
  );
}

function PlanEditorPage({
  page,
  opening,
  localState,
}: {
  readonly page: AgentPlanPage;
  readonly opening: AgentPlanOpening;
  readonly localState?: LocalStateMark;
}): React.ReactElement {
  const panels = usePlanPanels();
  const draftEditor = usePlanEditor(page, panels.editingNodeId !== null);
  const controls = usePlanControl(
    page.selected?.id,
    page.control,
    draftEditor.command.data,
  );
  const editor = {
    ...draftEditor,
    canEdit: canEditPlan(draftEditor.canEdit, controls, localState),
  };
  const requestedRunId = usePlanRequestedRunId();
  // A run the address names may be older than the newest ones the page holds.
  const summaries = usePlanRunSummaries(
    page.selected?.id,
    panels.consoleNodeId !== null || requestedRunId !== null,
  );
  const running = usePlanRun(page.runs, editor.command.data, {
    planId: page.selected?.id,
    control: controls.control,
    controlError: controls.error,
    summaries,
  });
  useOpenRequestedRun(requestedRunId, page.selected?.id, running.select);
  const display = planRunDisplay(page, controls.control, running);
  const saving = usePlanSave(editor, page.selected !== null);
  return (
    <div className="fixed inset-x-0 top-19 bottom-0 isolate @container md:left-(--app-sidebar-width)">
      <PlanEditorTitle name={page.selected?.name} />
      <PlanCanvas
        draft={editor.draft}
        sources={editor.sources}
        graph={editor.graph}
        canEdit={canEditCanvas(editor)}
        planId={page.selected?.id}
        onEdit={panels.onEdit}
        onOpen={panels.onOpen}
        run={display.run}
        runPlan={display.plan}
        runError={display.error}
        isReady={planReadiness(controls.control, editor.isDirty)}
        storedRunStatus={controls.control?.status}
        workspaceWait={planWorkspaceWait(display.run, controls.control)}
        tickets={editor.tickets}
        workspaces={parameterWorkspaces(page, editor.draft)}
        status={
          <PlanStatusNotices
            saving={saving}
            editor={editor}
            localState={localState}
          />
        }
        panel={
          <PlanRunPanel
            page={page}
            editor={editor}
            control={controls.control}
            run={display.run}
            error={controls.error}
            onRunStarted={(id) => running.select(id, "follow")}
            onRecoveryDecided={controls.readAgain}
          />
        }
      />
      <PlanCanvasEmpty
        opening={opening}
        isEmptyPlan={editor.draft.nodes.length === 0}
      />
      <PlanOnDemandPanels
        {...panels}
        editor={editor}
        run={display.run}
        running={running}
      />
      <PlanRevisionConflict editor={editor} />
      <PlanLeaveGuard isDirty={editor.isDirty} />
    </div>
  );
}

function usePlanRequestedRunId(): string | null {
  const [searchParams] = useSearchParams();
  return searchParams.get("runId");
}

function useOpenRequestedRun(
  runId: string | null,
  planId: string | undefined,
  select: (id: string, mode: "follow" | "history") => void,
): void {
  const open = useEffectEvent((id: string): void => select(id, "history"));
  useEffect(() => {
    if (runId && planId) open(runId);
  }, [runId, planId]);
}

interface RunSummariesResponse {
  readonly ok: boolean;
  readonly planId?: string;
  readonly runs?: readonly AgentPlanRunSummary[];
}

function usePlanRunSummaries(
  planId: string | undefined,
  isWanted: boolean,
): readonly AgentPlanRunSummary[] | null {
  const fetcher = useFetcher<RunSummariesResponse>();
  const { load } = fetcher;
  const response = fetcher.data;
  useEffect(() => {
    if (!isWanted || !planId) return;
    void load(
      `/agent-api/plan-run-summaries?${new URLSearchParams({ planId }).toString()}`,
    );
  }, [isWanted, planId, load]);
  return response?.ok && response.planId === planId
    ? (response.runs ?? null)
    : null;
}

function usePlanControl(
  planId: string | undefined,
  initial: AgentPlanControl | undefined,
  command: AgentPlanActionResult | undefined,
): {
  readonly control: AgentPlanControl | undefined;
  readonly error: string | null;
  readonly readAgain: () => void;
} {
  const [readRequest, setReadRequest] = useState(0);
  const poll = usePlanPoll(
    planId ? `/agent-api/plan-runs?planId=${encodeURIComponent(planId)}` : null,
    command,
    "always",
    readRequest,
  );
  return {
    control: poll.response?.ok ? (poll.response.control ?? initial) : initial,
    error: poll.error,
    readAgain: () => setReadRequest((request) => request + 1),
  };
}

function PlanLocalStateNotice({
  mark,
}: {
  readonly mark?: LocalStateMark;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { formatDateTime } = useRegionFormatter();
  if (!mark) return null;
  const isOffline = mark.state === "offline";
  const Icon = isOffline ? CloudOff : LoaderCircle;
  return (
    <p
      role={isOffline ? "alert" : "status"}
      data-local-state={mark.state}
      className={cn(
        "pointer-events-auto flex max-w-[min(36rem,calc(100vw-2rem))] items-center gap-2 rounded-lg border px-3 py-2 text-sm shadow-xs",
        isOffline
          ? "border-warning/40 bg-warning-subtle text-warning"
          : "border-border bg-surface text-muted-foreground",
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn("size-4 shrink-0", !isOffline && "animate-spin")}
      />
      {t(`plans.localState.${mark.state}`, {
        time: formatDateTime(new Date(mark.savedAt).toISOString()),
      })}
    </p>
  );
}

function isCreatedClone(location: {
  readonly pathname: string;
  readonly search: string;
  readonly state: unknown;
}): boolean {
  const { state } = location;
  return (
    location.pathname === "/agents/plans" &&
    typeof state === "object" &&
    state !== null &&
    "clonedPlanId" in state &&
    typeof state.clonedPlanId === "string" &&
    new URLSearchParams(location.search).get("planId") === state.clonedPlanId
  );
}

function PlanLeaveGuard(props: {
  readonly isDirty: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const blocker = useBlocker(
    ({ nextLocation }) => props.isDirty && !isCreatedClone(nextLocation),
  );
  useEffect(() => {
    if (!props.isDirty) return undefined;
    const warn = (event: BeforeUnloadEvent): void => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [props.isDirty]);
  return (
    <AgentDiscardDialog
      open={blocker.state === "blocked"}
      onOpenChange={(open) => {
        if (!open) blocker.reset?.();
      }}
      onDiscard={() => blocker.proceed?.()}
      title={t("plans.discardTitle")}
      description={t("plans.discardHint")}
    />
  );
}

function useEmptyText(
  opening: AgentPlanOpening,
  isEmptyPlan: boolean,
): { readonly title: string; readonly hint?: string } | null {
  const { t } = useTranslation();
  if (opening === "defaultMissing")
    return {
      title: t("plans.opening.defaultMissingTitle"),
      hint: t("plans.opening.defaultMissing", { name: DEFAULT_PLAN_NAME }),
    };
  if (opening === "requestedMissing")
    return {
      title: t("plans.opening.requestedMissingTitle"),
      hint: t("plans.opening.requestedMissing"),
    };
  return isEmptyPlan ? { title: t("plans.opening.emptyPlan") } : null;
}

function PlanCanvasEmpty(props: {
  readonly opening: AgentPlanOpening;
  readonly isEmptyPlan: boolean;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { revalidate, state } = useRevalidator();
  const text = useEmptyText(props.opening, props.isEmptyPlan);
  if (!text) return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8">
      <div
        role="status"
        className="max-w-sm rounded-2xl bg-background/80 px-5 py-4 text-center"
      >
        <p className="text-sm font-semibold">{text.title}</p>
        {text.hint ? (
          <p className="mt-1 text-sm text-muted-foreground">{text.hint}</p>
        ) : null}
        {props.opening === "requestedMissing" ? (
          <Button
            className="pointer-events-auto mt-3"
            variant="outline"
            size="sm"
            disabled={state !== "idle"}
            onClick={() => void revalidate()}
          >
            {t("plans.opening.retry")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
