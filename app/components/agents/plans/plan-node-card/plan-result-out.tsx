import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import { usePlanFlowContext } from "../plan-flow-context";
import { PlanFlowHandle } from "../plan-flow-handle";
import { PLAN_NODE_TEXT } from "../plan-node-text";

/**
 * The violet data OUT that hands an agent's or a script's result to a later node.
 *
 * @remarks
 * An agent's row reads "Ergebnis"; a script's row names its declared output.
 */
export function PlanResultOut(props: {
  readonly nodeId: string;
  /** The declared output a script delivers; absent for an agent. */
  readonly output?: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const { graph, canEdit } = usePlanFlowContext();
  const isActive =
    graph.connection?.nodeId === props.nodeId &&
    graph.connection.kind === "result";
  return (
    <div className="relative flex h-7 items-center justify-end">
      <Button
        size="xs"
        variant="ghost"
        aria-label={
          props.output === undefined
            ? t("plans.resultOut")
            : t("plans.scripts.outputOut", { name: props.output })
        }
        className={cn(
          "nodrag nopan -mr-1.25 h-7 min-h-7 max-w-full cursor-crosshair border border-transparent px-1 font-medium hover:bg-surface/70 xl:min-h-7 xl:px-1 xl:text-xs",
          PLAN_NODE_TEXT.field,
          isActive && "text-primary",
        )}
        disabled={!canEdit}
        onClick={() => graph.begin({ kind: "result", nodeId: props.nodeId })}
      >
        <span className="truncate">
          {props.output ?? t("plans.resultShort")}
        </span>
      </Button>
      <PlanFlowHandle id="value-out" type="source" kind="data" />
    </div>
  );
}
