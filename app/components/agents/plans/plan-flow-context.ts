import { createContext, useContext } from "react";

import type {
  AgentPlanInput,
  AgentPlanRun,
  AgentPlanSources,
} from "@/definition/AgentPlan";
import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";
import type { PlanGraphActions } from "./use-plan-graph";
import type { PlanTicketRefresh } from "./use-plan-ticket-refresh";

/** The Pages contracts accepted by the graph rendering layer. */
export interface PlanCanvasProps {
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
  readonly run: AgentPlanRun | null;
  /** Access or connection failure of the same run polling path. */
  readonly runError?: string | null;
  /** The workspaces of the plan's project, offered for workspace values. */
  readonly workspaces?: readonly AgentWorkspaceChoice[];
  /** Reads the tickets of the plan's project again for the ticket choice. */
  readonly tickets?: PlanTicketRefresh;
  readonly onEdit?: (id: string) => void;
  readonly onOpen?: (id: string) => void;
  /** Page controls stacked above the zoom bar, outside canvas gestures. */
  readonly panel?: React.ReactNode;
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
