import { createContext, useContext } from "react";

import type {
  AgentPlanInput,
  AgentPlanRun,
  AgentPlanSources,
} from "@/definition/AgentPlan";
import type { PlanGraphActions } from "./use-plan-graph";

/** The Pages contracts accepted by the graph rendering layer. */
export interface PlanCanvasProps {
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
  readonly run: AgentPlanRun | null;
  readonly onEdit?: (id: string) => void;
  readonly onOpen?: (id: string) => void;
  /** Notices of the page, such as a refused save, below the zoom bar. */
  readonly status?: React.ReactNode;
}

/** Editor actions stay outside the domain objects projected into React Flow. */
export interface PlanFlowContextValue extends PlanCanvasProps {
  readonly dropTarget: string | null;
  readonly cancelConnection: () => void;
}

export const PlanFlowContext = createContext<PlanFlowContextValue | null>(null);

/** Supplies the same guarded actions to custom nodes and custom edges. */
export function usePlanFlowContext(): PlanFlowContextValue {
  const context = useContext(PlanFlowContext);
  if (!context) throw new Error("Plan flow context is missing");
  return context;
}
