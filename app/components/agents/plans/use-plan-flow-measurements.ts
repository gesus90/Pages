import { useState } from "react";

import type { Dimensions, NodeChange } from "@xyflow/react";
import type { PlanFlowNode } from "./plan-flow-model";

interface FlowMeasurements {
  readonly measurements: Readonly<Record<string, Dimensions>>;
  readonly measure: (changes: NodeChange<PlanFlowNode>[]) => void;
}

/** Keeps React Flow's measurements across projections without persisting them in the plan. */
export function usePlanFlowMeasurements(): FlowMeasurements {
  const [measurements, setMeasurements] = useState<
    Readonly<Record<string, Dimensions>>
  >({});
  function measure(changes: NodeChange<PlanFlowNode>[]): void {
    const dimensions = changes.flatMap((change) =>
      change.type === "dimensions" && change.dimensions
        ? [[change.id, change.dimensions] as const]
        : [],
    );
    if (dimensions.length === 0) return;
    setMeasurements((previous) => ({
      ...previous,
      ...Object.fromEntries(dimensions),
    }));
  }
  return { measurements, measure };
}
