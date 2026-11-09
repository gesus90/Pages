import { createContext, useContext } from "react";

import type {
  AgentPlanInput,
  AgentPlanRun,
  AgentPlanSources,
} from "@/definition/AgentPlan";
import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";
import type { PlanGraphActions } from "./use-plan-graph";
import type { PlanTicketRefresh } from "./use-plan-ticket-refresh";

/** The Pages contracts accepted by the graph rendering layer. */
export interface PlanCanvasProps {
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
  /** The saved plan; absent before its first save. */
  readonly planId?: string;
  readonly run: AgentPlanRun | null;
  /** The saved revision the shown run executes; absent when that revision is not loaded. */
  readonly runPlan?: AgentPlanInput;
  /** Access or connection failure of the same run polling path. */
  readonly runError?: string | null;
  /** Whether the saved plan may start now, as long as no run is shown; absent while unknown. */
  readonly isReady?: boolean;
  /**
   * The stored status of the newest run from the plan control.
   *
   * @remarks
   * Named while no run is shown, because the reader's history is empty or
   * refused; an ended run then never reads as a plan that has not run.
   */
  readonly storedRunStatus?: AgentPlanControl["status"];
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
  readonly collapsedGroups: ReadonlySet<string>;
  readonly toggleGroup: (id: string) => void;
  readonly dropTarget: string | null;
  readonly cancelConnection: () => void;
  /** Opens the dialog that saves a parameter, agent or group node as a template. */
  readonly requestTemplate: (nodeId: string) => void;
}

export const PlanFlowContext = createContext<PlanFlowContextValue | null>(null);

/** Supplies the same guarded actions to custom nodes and custom edges. */
export function usePlanFlowContext(): PlanFlowContextValue {
  const context = useContext(PlanFlowContext);
  if (!context) throw new Error("Plan flow context is missing");
  return context;
}
