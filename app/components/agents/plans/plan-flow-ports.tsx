import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";
import { isPlanFlowNode } from "@/definition/AgentPlanGraph";

import type { AgentPlanNode } from "@/definition/AgentPlan";
import type { PlanGraphActions } from "./use-plan-graph";

/** Start exposes only OUT; end exposes only IN; agents expose both; value sources such as tickets have none. */
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
    <div className="flex h-8 items-center justify-between gap-2">
      {node.type !== "start" ? (
        <Button
          size="sm"
          variant="outline"
          className={cn(
            issue("flow-in") && "border-destructive text-destructive",
          )}
          disabled={!props.canEdit || !graph.connection}
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
          className={cn(
            issue("flow-out") && "border-destructive text-destructive",
          )}
          disabled={!props.canEdit}
          onClick={() => graph.begin({ kind: "flow", nodeId: node.id })}
        >
          {t("plans.flowOut")}
        </Button>
      ) : null}
    </div>
  );
}
