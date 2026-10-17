import { useState } from "react";

import { cn } from "@/app/lib/cn";

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

const OPEN_SIDE: PlanWorkspaceStyle = { "--plan-side": "min(24rem, 40%)" };
const CLOSED_SIDE: PlanWorkspaceStyle = { "--plan-side": "2.25rem" };

/**
 * The plan grid fills the work area below the global header and blends into the page.
 *
 * @remarks
 * On wide screens the configuration, the source and selection panel and the
 * run details float over the grid in three separate areas that never overlap
 * each other; narrow screens stack them around the grid instead.
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
      className="relative isolate flex flex-col gap-3 xl:block xl:h-[calc(100dvh-8.5rem)] xl:min-h-[34rem]"
      style={isSideOpen ? OPEN_SIDE : CLOSED_SIDE}
    >
      <PlanConfigurationPanel
        page={page}
        editor={editor}
        run={running.run}
        className="xl:absolute xl:top-0 xl:right-[calc(var(--plan-side)+0.75rem)] xl:left-0 xl:z-10"
      />
      <div className="relative h-[60dvh] min-h-[24rem] xl:absolute xl:inset-0 xl:h-auto">
        <PlanCanvas
          draft={editor.draft}
          sources={editor.sources}
          graph={editor.graph}
          canEdit={!disabled && Boolean(editor.draft.workspaceId)}
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
        className={cn(
          "xl:absolute xl:top-0 xl:right-0 xl:z-10 xl:w-[var(--plan-side)]",
          isSideOpen && "xl:bottom-0",
        )}
      />
      <PlanDetailsPanel
        state={running}
        editor={editor}
        hasRuns={page.runs.length > 0}
        className="xl:absolute xl:right-[calc(var(--plan-side)+0.75rem)] xl:bottom-0 xl:left-0 xl:z-10"
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
