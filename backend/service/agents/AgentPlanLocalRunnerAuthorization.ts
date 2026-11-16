import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import { AgentError } from "@/backend/error/AgentErrors";

import type { AgentPlanAccess } from "./AgentPlanAccess";
import type { AgentParameterService } from "./AgentParameterService";
import type { RemotePlanStep } from "./AgentPlanRemoteExecution";
import type { AgentPlanScriptPreparation } from "./AgentPlanScriptPreparation";
import type { AgentProfileService } from "./AgentProfileService";

/** Rechecks the original local permissions and account before dispatch or adoption. */
export async function authorizeLocalRunnerSource(
  services: {
    readonly plans: Pick<AgentPlanAccess, "require">;
    readonly scripts: AgentPlanScriptPreparation;
    readonly profiles: AgentProfileService;
    readonly parameters: AgentParameterService;
  },
  userId: string,
  source: NonNullable<RemotePlanStep["localSource"]>,
): Promise<void> {
  await services.plans.require(userId, source.plan.id);
  if (source.script)
    await services.scripts.reauthorize(userId, source.plan, source.script);
  if (!source.agent) return;
  const original = source.agent;
  const selection = {
    agentId: original.step.agentId,
    personalAgentId: original.step.personalAgentId,
    projectId: source.plan.projectId,
    configuration: original.step.configuration,
  };
  const resolved = await services.profiles.resolveDefinition(userId, selection);
  if (
    resolved.assignment.connection.id !== original.connectionId ||
    resolved.assignment.model !== original.model ||
    resolved.assignment.connection.provider !== original.provider
  )
    throw new AgentError("plan_context_changed");
  const prepared = await services.parameters.prepare(
    userId,
    { ...selection, workspaceId: source.plan.workspaceId },
    original.prepared.parameters.values,
    original.template,
  );
  if (
    planContentDigest([prepared.workspace, prepared.directory]) !==
    planContentDigest([
      original.prepared.workspace,
      original.prepared.directory,
    ])
  )
    throw new AgentError("plan_context_changed");
}
