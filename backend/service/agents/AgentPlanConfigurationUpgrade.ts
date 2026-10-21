import { configurationForTargets } from "@/backend/agents/AgentConfigurationInput";
import { copyPlanConfiguration } from "@/definition/AgentPlanConfiguration";
import { AgentError } from "@/backend/error/AgentErrors";
import { logEvent } from "@/backend/logging/Logger";

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
 * revision check. Pinned content stays intact; only unambiguous connection
 * references are added. Historical run snapshots are never rewritten.
 */
export async function upgradePlanConfigurations(
  dependencies: UpgradeDependencies,
): Promise<void> {
  const profiles = await dependencies.profiles.list();
  for (const plan of await dependencies.plans.list()) {
    const nodes: AgentPlanNode[] = [];
    for (const node of plan.nodes)
      nodes.push(await pinLegacyNode(node, profiles, dependencies.connections));
    if (!nodes.some((node, index) => node !== plan.nodes[index])) continue;
    try {
      await dependencies.plans.save({ ...plan, nodes }, false);
    } catch (error: unknown) {
      if (
        !(error instanceof AgentError) ||
        ![
          "plan_context_changed",
          "plan_conflict",
          "plan_pause_required",
        ].includes(error.code)
      )
        throw error;
      logEvent({
        component: "AgentPlanConfigurationUpgrade",
        event: "agent.plan.configuration_upgrade.deferred",
        level: "warn",
        message:
          "The original plan is retained for explicit repair or after its active run ends.",
        metadata: { source: plan.id, reason: error.code },
        error,
      });
    }
  }
}

async function pinLegacyNode(
  node: AgentPlanNode,
  profiles: readonly AgentProfile[],
  connections: UpgradeDependencies["connections"],
): Promise<AgentPlanNode> {
  if (node.type === "group") {
    const steps = await Promise.all(
      node.steps.map(async (step) => {
        const upgraded = await pinLegacyNode(step, profiles, connections);
        return upgraded.type === "agent" ? upgraded : step;
      }),
    );
    return steps.some((step, index) => step !== node.steps[index])
      ? { ...node, steps }
      : node;
  }
  if (node.type === "loop") {
    const steps = await Promise.all(
      node.steps.map(async (step) => {
        const upgraded = await pinLegacyNode(step, profiles, connections);
        return upgraded.type === "agent" || upgraded.type === "script"
          ? upgraded
          : step;
      }),
    );
    return steps.some((step, index) => step !== node.steps[index])
      ? { ...node, steps }
      : node;
  }
  if (node.type !== "agent") return node;
  if (node.configuration) return directReference(node, profiles, connections);
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
  const pinned = {
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
  return directReference(pinned, profiles, connections);
}

async function directReference(
  node: Extract<AgentPlanNode, { type: "agent" }>,
  profiles: readonly AgentProfile[],
  connections: UpgradeDependencies["connections"],
): Promise<AgentPlanNode> {
  const configuration = node.configuration;
  if (!configuration || configuration.connectionId) return node;
  const source = profiles.find(
    (profile) => profile.id === configuration.modelProfileId,
  );
  if (!source || source.model !== configuration.model) return node;
  const connection = await connections.find(source.connectionId);
  if (!connection || connection.provider !== configuration.provider)
    return node;
  return {
    ...node,
    configuration: { ...configuration, connectionId: connection.id },
  };
}
