import { useState } from "react";
import { useTranslation } from "react-i18next";

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
import type { AgentPlanPage } from "@/definition/AgentPlan";

/**
 * The plan editor: one canvas over the whole content area beside the navigation.
 *
 * @remarks
 * The canvas runs from the global header to the bottom of the window and
 * shows only nodes, connections and the zoom bar. The node dialog and the
 * agent console appear only when a node asks for them, and Ctrl+S or Cmd+S
 * saves. Run updates never remount the canvas.
 */
export function PlanPage({
  page,
  opening,
}: {
  readonly page: AgentPlanPage;
  readonly opening: AgentPlanOpening;
}): React.ReactElement {
  const { t } = useTranslation();
  const editor = usePlanEditor(page);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [consoleNodeId, setConsoleNodeId] = useState<string | null>(null);
  const running = usePlanRun(page.runs, editor.command.data);
  const displayedRun =
    !editor.isDirty &&
    running.run?.planId === page.selected?.id &&
    running.run?.planRevision === editor.draft.revision
      ? running.run
      : null;
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
    <div className="fixed inset-x-0 top-19 bottom-0 isolate md:left-(--app-sidebar-width)">
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
        onEdit={setEditingNodeId}
        onOpen={setConsoleNodeId}
        run={displayedRun}
        workspaces={page.workspaces.filter(
          (workspace) => workspace.projectId === projectId,
        )}
        status={
          <PlanSaveNotice
            feedback={saving.feedback}
            onDismiss={saving.dismiss}
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
