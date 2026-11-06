import type { AgentPlanRunEngine } from "../AgentPlanRunEngine";
import type { PlanRunCommandReceipt } from "@/definition/PagesRuns";

/** Public execution boundary shared by the embedded engine and durable API producer. */
export type PlanRunEnginePort = Pick<
  AgentPlanRunEngine,
  | "start"
  | "startRecovered"
  | "stop"
  | "pause"
  | "resume"
  | "resetLogical"
  | "stopProject"
  | "isShuttingDown"
  | "adopt"
  | "unverifiedLocalSessions"
  | "shutdown"
> & {
  readonly isActive: (runId: string) => boolean | Promise<boolean>;
  readonly commandReceipt?: (
    runId: string,
  ) => Promise<PlanRunCommandReceipt | null>;
};
