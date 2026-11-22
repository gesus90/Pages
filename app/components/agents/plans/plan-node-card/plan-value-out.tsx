import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import { usePlanFlowContext } from "../plan-flow-context";
import { PlanFlowHandle } from "../plan-flow-handle";
import { PLAN_NODE_TEXT } from "../plan-node-text";
import { PLAN_CARD_ROW } from "./plan-card";

/**
 * The data OUT of a value source: its name right-aligned in the output
 * column and its dot on the right card edge.
 * @remarks
 * The dot is dragged or clicked; the name is the labelled button that
 * keyboards use.
 */
export function PlanValueOut(props: {
  readonly nodeId: string;
  /** The translation key of the button's accessible name, such as `plans.ticketOut`. */
  readonly labelKey: string;
  /** The translation key of the shown name, such as `plans.field.ticket`. */
  readonly textKey: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const { graph, canEdit } = usePlanFlowContext();
  const isActive =
    graph.connection?.nodeId === props.nodeId &&
    graph.connection.kind === "source";
  return (
    <div className={cn(PLAN_CARD_ROW, "justify-end")}>
      <Button
        size="xs"
        variant="ghost"
        aria-label={t(props.labelKey)}
        className={cn(
          "nodrag nopan -mr-1 h-7 min-h-7 max-w-full cursor-crosshair border border-transparent px-1 font-normal text-muted-foreground hover:bg-muted xl:min-h-7 xl:px-1 xl:text-xs",
          PLAN_NODE_TEXT.field,
          isActive && "text-primary",
        )}
        disabled={!canEdit}
        onClick={() => graph.begin({ kind: "source", nodeId: props.nodeId })}
      >
        <span className="truncate">{t(props.textKey)}</span>
      </Button>
      <PlanFlowHandle id="value-out" type="source" kind="data" />
    </div>
  );
}
