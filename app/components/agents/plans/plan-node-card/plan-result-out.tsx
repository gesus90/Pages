import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import { usePlanFlowContext } from "../plan-flow-context";
import { PlanFlowHandle } from "../plan-flow-handle";
import { PLAN_NODE_TEXT } from "../plan-node-text";
import { PLAN_CARD_ROW } from "./plan-card";

/**
 * The data OUT that hands an agent's or a script's result to a later node,
 * right-aligned in the output column with its dot on the card edge.
 * @remarks
 * An agent's row reads "Ergebnis OUT", apart from its boolean result; a
 * script's row names its declared output. A text result can also end at the
 * event input of an agent.
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
    <div className={cn(PLAN_CARD_ROW, "justify-end")}>
      <Button
        size="xs"
        variant="ghost"
        aria-label={
          props.output === undefined
            ? t("plans.resultOut")
            : t("plans.scripts.outputOut", { name: props.output })
        }
        className={cn(
          "nodrag nopan -mr-1 h-7 min-h-7 max-w-full cursor-crosshair border border-transparent px-1 font-normal text-muted-foreground hover:bg-muted xl:min-h-7 xl:px-1 xl:text-xs",
          PLAN_NODE_TEXT.field,
          isActive && "text-primary",
        )}
        disabled={!canEdit}
        onClick={() => graph.begin({ kind: "result", nodeId: props.nodeId })}
      >
        <span className="truncate">
          {props.output ?? t("plans.resultOutShort")}
        </span>
      </Button>
      <PlanFlowHandle id="value-out" type="source" kind="data" />
    </div>
  );
}
