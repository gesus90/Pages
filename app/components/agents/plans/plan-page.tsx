import { useState } from "react";

import { PlanAgentConsole } from "./plan-agent-console";
import { PlanNodeDialog } from "./plan-node-dialog";
import { PlanCanvas } from "./plan-canvas";
import { PlanConfigurationPanel } from "./plan-configuration-panel";
import { PlanDetailsPanel } from "./plan-details-panel";
import { PlanPanel } from "./plan-panel";
import { PlanLeaveGuard } from "./plan-leave-guard";
import { usePlanEditor } from "./use-plan-editor";
import { usePlanRun } from "./use-plan-run";

import type { AgentPlanPage } from "@/definition/AgentPlan";

/** Width of the right panel, which the top and bottom panels keep clear of. */
interface PlanWorkspaceStyle extends React.CSSProperties {
  readonly "--plan-side": string;
}

const OPEN_SIDE: PlanWorkspaceStyle = { "--plan-side": "min(23rem, 40vw)" };
const CLOSED_SIDE: PlanWorkspaceStyle = { "--plan-side": "2.25rem" };

/**
 * A framed canvas keeps the toolbar, inspector and run details in their own layout areas.
 *
 * @remarks
 * The inspector sits beside the graph on desktop and tablet; narrow screens
 * stack the collapsible panels. Run updates never remount the canvas.
 */
export function PlanPage({
  page,
}: {
  readonly page: AgentPlanPage;
}): React.ReactElement {
  const editor = usePlanEditor(page);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [consoleNodeId, setConsoleNodeId] = useState<string | null>(null);
  const [isSideOpen, setSideOpen] = useState(true);
  const running = usePlanRun(page.runs, editor.command.data);
  const disabled = !editor.canEdit || editor.isPending;
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
    <div
      className="relative isolate flex flex-col gap-3 lg:h-[calc(100dvh-8.5rem)] lg:min-h-[42rem]"
      style={isSideOpen ? OPEN_SIDE : CLOSED_SIDE}
    >
      <PlanConfigurationPanel
        page={page}
        editor={editor}
        run={running.run}
        className="shrink-0"
      />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:min-h-[24rem] lg:grid-cols-[minmax(0,1fr)_var(--plan-side)]">
        <div className="relative h-[60dvh] min-h-[24rem] min-w-0 lg:h-auto">
          <PlanCanvas
            draft={editor.draft}
            sources={editor.sources}
            graph={editor.graph}
            canEdit={!disabled && Boolean(editor.draft.workspaceId)}
            isReadOnly={!editor.canEdit}
            onEdit={setEditingNodeId}
            onOpen={setConsoleNodeId}
            run={running.run}
          />
        </div>
        <PlanPanel
          page={page}
          editor={editor}
          run={running.run}
          isOpen={isSideOpen}
          onOpenChange={setSideOpen}
        />
      </div>
      <PlanDetailsPanel
        state={running}
        editor={editor}
        hasRuns={page.runs.length > 0}
        className="max-h-[35dvh] shrink-0"
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
