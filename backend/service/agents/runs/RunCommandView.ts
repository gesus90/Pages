import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { PlanRunEnginePort } from "./PlanRunEnginePort";

/** Adds the public command outcome only after the service has authorized the run. */
export async function withRunCommand(
  engine: Pick<PlanRunEnginePort, "commandReceipt"> | undefined,
  run: AgentPlanRun,
): Promise<AgentPlanRun> {
  const command = await engine?.commandReceipt?.(run.id);
  return command ? { ...run, command } : run;
}
