import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";
import { isPlanFlowNode } from "@/definition/AgentPlanGraph";

import { PlanFlowHandle } from "./plan-flow-handle";

import type { AgentPlanNode } from "@/definition/AgentPlan";
import type { PlanGraphActions } from "./use-plan-graph";

// A card shows the short labels In and Out beside its ports; a frame keeps
// its outlined buttons. The accessible names stay complete in both.
const PORT_STYLES = {
  compact: {
    row: "h-7",
    // The labels share the left text edge of the input names below them.
    port: "nodrag nopan h-7 min-h-7 border-transparent bg-transparent px-1 text-xs leading-4.5 font-medium shadow-none hover:bg-surface/70 focus-visible:ring-2 focus-visible:ring-ring xl:min-h-7 xl:px-1 xl:text-xs",
    inLabel: "plans.flowInShort",
    outLabel: "plans.flowOutShort",
  },
  regular: {
    row: "h-8",
    port: "nodrag nopan h-7 min-h-7 px-2 text-xs leading-4.5 focus-visible:ring-2 focus-visible:ring-ring xl:min-h-7 xl:text-xs",
    inLabel: "plans.flowIn",
    outLabel: "plans.flowOut",
  },
};

/**
 * Marks an IN as an allowed or a refused end of the connection being made.
 *
 * @returns No class while no connection is open.
 */
export function planInTargetClass(
  graph: PlanGraphActions,
  id: string,
  parameter?: string,
): string | false {
  if (!graph.connection) return false;
  return graph.canConnect(id, parameter)
    ? "border-success bg-success-subtle text-success"
    : "cursor-not-allowed border-dashed opacity-50";
}

/**
 * Start exposes only OUT; end exposes only IN; agents expose both; value sources such as tickets have none.
 *
 * @remarks
 * Dragging from an OUT to an IN connects them; clicking the OUT and then the
 * IN does the same without a drag.
 */
export function PlanFlowPorts(props: {
  readonly node: AgentPlanNode;
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
  /** A card shows the short labels In and Out; their names stay complete. */
  readonly isCompact?: boolean;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { node, graph, isCompact = false } = props;
  if (!isPlanFlowNode(node)) return null;
  function issue(port: string): boolean {
    return graph.issues.some(
      (entry) => entry.nodeId === node.id && entry.port === port,
    );
  }
  const style = PORT_STYLES[isCompact ? "compact" : "regular"];
  return (
    <div
      className={cn(
        "relative flex items-center justify-between gap-2",
        style.row,
      )}
    >
      {node.type !== "start" ? (
        <Button
          size="sm"
          variant="outline"
          data-plan-in={node.id}
          aria-label={t("plans.flowIn")}
          className={cn(
            style.port,
            isCompact && "-ml-1.25",
            issue("flow-in") && "border-destructive text-destructive",
            planInTargetClass(graph, node.id),
          )}
          disabled={!props.canEdit}
          onClick={() => graph.connect(node.id)}
        >
          {t(style.inLabel)}
        </Button>
      ) : (
        <span />
      )}
      {node.type !== "end" ? (
        <Button
          size="sm"
          variant="outline"
          data-plan-out={node.id}
          data-plan-out-kind="flow"
          aria-label={t("plans.flowOut")}
          className={cn(
            style.port,
            isCompact && "-mr-1.25",
            "cursor-crosshair",
            issue("flow-out") && "border-destructive text-destructive",
            graph.connection?.nodeId === node.id &&
              graph.connection.kind === "flow" &&
              "border-primary text-primary",
          )}
          disabled={!props.canEdit}
          onClick={() => graph.begin({ kind: "flow", nodeId: node.id })}
        >
          {t(style.outLabel)}
        </Button>
      ) : null}
      {node.type !== "start" ? (
        <PlanFlowHandle
          id="flow-in"
          type="target"
          kind="flow"
          hasIssue={issue("flow-in")}
        />
      ) : null}
      {node.type !== "end" ? (
        <PlanFlowHandle
          id="flow-out"
          type="source"
          kind="flow"
          hasIssue={issue("flow-out")}
        />
      ) : null}
    </div>
  );
}
