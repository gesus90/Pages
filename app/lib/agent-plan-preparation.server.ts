import { AgentPlanPreparation } from "@/backend/service/agents/AgentPlanPreparation";

import type { AgentApplicationServices } from "./agent-services.server";
import type { PlanDependencies } from "@/backend/service/agents/AgentPlanDependencies";
import type { PlanAgentServices } from "./plan-agent-services.server";

/** Builds preparation using the shared plan assets. */
export function createPlanPreparation(
  input: { readonly agents: PlanAgentServices },
  dependencies: Omit<
    ConstructorParameters<typeof AgentPlanPreparation>[0],
    keyof ReturnType<typeof planAssetsOf>
  >,
): AgentPlanPreparation {
  return new AgentPlanPreparation({
    ...dependencies,
    ...planAssetsOf(input.agents),
  });
}

/** The file store of asset nodes, where one was wired. */
export function planAssetsOf(
  agents: Pick<AgentApplicationServices, "agentPlanAssetService">,
): Pick<PlanDependencies, "planAssets"> {
  return agents.agentPlanAssetService
    ? { planAssets: agents.agentPlanAssetService }
    : {};
}
