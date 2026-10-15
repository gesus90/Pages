import { configurationForTargets } from "@/backend/agents/AgentConfigurationInput";
import { copyPlanConfiguration } from "@/definition/AgentPlanConfiguration";

import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import type { AgentProfileRepository } from "@/backend/database/repositories/agent/AgentProfileRepository";
import type { AgentPlanNode } from "@/definition/AgentPlan";
import type { AgentProfile } from "@/definition/AgentProfile";

interface UpgradeDependencies {
  readonly plans: Pick<AgentPlanRepository, "list" | "save">;
  readonly profiles: Pick<AgentProfileRepository, "list">;
  readonly connections: Pick<AgentConnectionRepository, "find">;
}

/**
 * Pins legacy JSON graphs before the application accepts template edits.
 *
 * @remarks
 * There is no schema change. Each changed graph uses its existing atomic
 * revision check; already pinned nodes and historical run snapshots stay intact.
 */
export async function upgradePlanConfigurations(
  dependencies: UpgradeDependencies,
): Promise<void> {
  const profiles = await dependencies.profiles.list();
  for (const plan of await dependencies.plans.list()) {
    const nodes: AgentPlanNode[] = [];
    for (const node of plan.nodes)
      nodes.push(await pinLegacyNode(node, profiles, dependencies.connections));
    if (nodes.some((node, index) => node !== plan.nodes[index]))
      await dependencies.plans.save({ ...plan, nodes }, false);
  }
}

async function pinLegacyNode(
  node: AgentPlanNode,
  profiles: readonly AgentProfile[],
  connections: UpgradeDependencies["connections"],
): Promise<AgentPlanNode> {
  if (node.type !== "agent" || node.configuration) return node;
  const source = profiles.find((profile) => profile.id === node.agentId);
  if (!source) return node;
  const configuration =
    source.configuration ?? configurationForTargets(source.targets);
  const connection = await connections.find(source.connectionId);
  const modelProfileId =
    node.personalAgentId ??
    (configuration.accessMode === "personal"
      ? ""
      : (source.modelProfileId ?? source.id));
  return {
    ...node,
    configuration: copyPlanConfiguration({
      id: source.id,
      name: source.name,
      modelProfileId,
      model: source.model,
      provider: connection?.provider ?? null,
      reasoningEffort: source.reasoningEffort,
      revision: source.revision ?? 1,
      purposes: source.purposes,
      configuration,
      availability: { isUsable: false, reason: null, personalChoices: [] },
    }),
  };
}
