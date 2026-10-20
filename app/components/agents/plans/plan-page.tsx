import { useState } from "react";
import { useTranslation } from "react-i18next";

import { PlanRunPanel } from "./plan-run-panel";
import { usePlanControl } from "./use-plan-control";
import { PlanAgentConsole } from "./plan-agent-console";
import { PlanNodeDialog } from "./plan-node-dialog";
import { PlanCanvas } from "./plan-canvas";
import { PlanCanvasEmpty } from "./plan-canvas-empty";
import { PlanLeaveGuard } from "./plan-leave-guard";
import { PlanSaveNotice } from "./plan-save-notice";
import { usePlanEditor } from "./use-plan-editor";
import { usePlanRun } from "./use-plan-run";
import { usePlanSave } from "./use-plan-save";

import type { AgentPlanOpening } from "@/app/lib/agent-plan-default";
import type { AgentPlanPage, AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";

interface PlanRunDisplay {
  readonly run: AgentPlanRun | null;
  readonly error: string | null;
}

function planRunDisplay(
  page: AgentPlanPage,
  control: AgentPlanControl | undefined,
  running: ReturnType<typeof usePlanRun>,
): PlanRunDisplay {
  const run = running.run?.planId === page.selected?.id ? running.run : null;
  let error = running.error;
  // Shared control metadata never grants access to the executor's run details.
  if (!error && page.selected?.canEdit === false && control?.runId && !run)
    error = "plan_run_unavailable";
  return { run, error };
}

/**
 * The plan editor: one canvas over the whole content area beside the navigation.
 *
 * @remarks
 * The canvas runs from the global header to the bottom of the window and
 * shows nodes, connections and the zoom bar beneath a floating run panel.
 * The node dialog and agent console appear only when requested; Ctrl+S or
 * Cmd+S saves. Run updates never remount the canvas.
 */
export function PlanPage({
  page,
  opening,
}: {
  readonly page: AgentPlanPage;
  readonly opening: AgentPlanOpening;
}): React.ReactElement {
  const { t } = useTranslation();
  const draftEditor = usePlanEditor(page);
  const controls = usePlanControl(
    page.selected?.id,
    page.control,
    draftEditor.command.data,
  );
  const editor = {
    ...draftEditor,
    canEdit:
      draftEditor.canEdit &&
      (!controls.error || controls.error === "plan_connection_unavailable") &&
      (controls.control?.canEdit ?? true),
  };
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [consoleNodeId, setConsoleNodeId] = useState<string | null>(null);
  const running = usePlanRun(page.runs, editor.command.data);
  const display = planRunDisplay(page, controls.control, running);
  const saving = usePlanSave(editor, page.selected !== null);
  const disabled = !editor.canEdit || editor.isPending;
  const projectId = page.workspaces.find(
    (workspace) => workspace.id === editor.draft.workspaceId,
  )?.projectId;
  function closeConsole(): void {
    const nodeId = consoleNodeId;
    setConsoleNodeId(null);
    // Focus returns to the node that opened the console, without moving the canvas.
    if (nodeId)
      document
        .querySelector<HTMLElement>(
          `[data-plan-handle="${CSS.escape(nodeId)}"]`,
        )
        ?.focus({ preventScroll: true });
  }
  return (
    <div className="fixed inset-x-0 top-19 bottom-0 isolate @container md:left-(--app-sidebar-width)">
      <h1 className="sr-only">
        {page.selected
          ? `${t("plans.title")} · ${page.selected.name}`
          : t("plans.title")}
      </h1>
      <PlanCanvas
        draft={editor.draft}
        sources={editor.sources}
        graph={editor.graph}
        canEdit={!disabled && Boolean(editor.draft.workspaceId)}
        planId={page.selected?.id}
        onEdit={setEditingNodeId}
        onOpen={setConsoleNodeId}
        run={display.run}
        runError={display.error}
        tickets={editor.tickets}
        workspaces={page.workspaces.filter(
          (workspace) => workspace.projectId === projectId,
        )}
        status={
          <PlanSaveNotice
            feedback={saving.feedback}
            onDismiss={saving.dismiss}
          />
        }
        panel={
          <PlanRunPanel
            page={page}
            editor={editor}
            control={controls.control}
            error={controls.error}
            onRunStarted={running.select}
          />
        }
      />
      <PlanCanvasEmpty
        opening={opening}
        isEmptyPlan={editor.draft.nodes.length === 0}
      />
      <PlanNodeDialog
        nodeId={editingNodeId}
        editor={editor}
        run={display.run}
        onClose={() => setEditingNodeId(null)}
      />
      {consoleNodeId ? (
        <PlanAgentConsole
          nodeId={consoleNodeId}
          draft={editor.draft}
          sources={editor.sources}
          running={running}
          onClose={closeConsole}
        />
      ) : null}
      <PlanLeaveGuard isDirty={editor.isDirty} />
    </div>
  );
}
