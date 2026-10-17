import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";
import { isPlanFlowNode } from "@/definition/AgentPlanGraph";

import { PlanFlowHandle } from "./plan-flow-handle";

import type { AgentPlanNode } from "@/definition/AgentPlan";
import type { PlanGraphActions } from "./use-plan-graph";

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
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { node, graph } = props;
  if (!isPlanFlowNode(node)) return null;
  function issue(port: string): boolean {
    return graph.issues.some(
      (entry) => entry.nodeId === node.id && entry.port === port,
    );
  }
  return (
    <div className="relative flex h-8 items-center justify-between gap-2">
      {node.type !== "start" ? (
        <Button
          size="sm"
          variant="outline"
          data-plan-in={node.id}
          className={cn(
            "nodrag nopan h-7 min-h-7 px-2 text-xs focus-visible:ring-2 focus-visible:ring-ring xl:min-h-7",
            issue("flow-in") && "border-destructive text-destructive",
            planInTargetClass(graph, node.id),
          )}
          disabled={!props.canEdit}
          onClick={() => graph.connect(node.id)}
        >
          {t("plans.flowIn")}
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
          className={cn(
            "nodrag nopan h-7 min-h-7 cursor-crosshair px-2 text-xs focus-visible:ring-2 focus-visible:ring-ring xl:min-h-7",
            issue("flow-out") && "border-destructive text-destructive",
            graph.connection?.nodeId === node.id &&
              graph.connection.kind === "flow" &&
              "border-primary text-primary",
          )}
          disabled={!props.canEdit}
          onClick={() => graph.begin({ kind: "flow", nodeId: node.id })}
        >
          {t("plans.flowOut")}
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
