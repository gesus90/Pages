import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import { usePlanFlowContext } from "../plan-flow-context";
import { PlanFlowHandle } from "../plan-flow-handle";

/**
 * The violet data OUT of a value source, anchored at the row of its value.
 *
 * @remarks
 * The port is dragged or clicked; keyboards use the labelled button, which
 * shows only while it has the focus.
 */
export function PlanValueOut(props: {
  readonly nodeId: string;
  /** The translation key of the button, such as `plans.ticketOut`. */
  readonly labelKey: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const { graph, canEdit } = usePlanFlowContext();
  return (
    <>
      <PlanFlowHandle id="value-out" type="source" kind="data" />
      <Button
        size="xs"
        variant="ghost"
        className="nodrag nopan sr-only focus:not-sr-only focus:absolute focus:top-full focus:right-0 focus:z-10 focus:mt-1 focus:bg-surface focus:shadow-xs"
        disabled={!canEdit}
        onClick={() => graph.begin({ kind: "source", nodeId: props.nodeId })}
      >
        {t(props.labelKey)}
      </Button>
    </>
  );
}
