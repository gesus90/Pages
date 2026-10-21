import { agentProfilePriority } from "@/backend/auth/AgentProfilePolicy";
import { AgentError } from "@/backend/error/AgentErrors";

import { resolveAgentAssignmentFor } from "./AgentAssignmentResolution";

import type { AgentProfileService } from "./AgentProfileService";
import type { AgentPlanRunResources } from "@/backend/agents/AgentPlanRunResources";
import type { AgentViewer } from "@/backend/auth/AgentProfilePolicy";
import type { AgentPlanConfiguration } from "@/definition/AgentPlanConfiguration";
import type { AgentProfile } from "@/definition/AgentProfile";
import type { ProfileDependencies } from "./AgentProfileService";
import type { ResolvedAgentAssignment } from "./AgentAssignmentResolution";

/** Rechecks a node's pinned model against its current administrative grant, independently of template edits. */
export async function resolvePlanModel(
  dependencies: ProfileDependencies,
  viewer: AgentViewer,
  configuration: AgentPlanConfiguration,
  context: {
    readonly profiles: readonly AgentProfile[];
    readonly projectId: string | null;
  },
): Promise<{
  readonly assignment: ResolvedAgentAssignment;
  readonly accessAgentId: string;
}> {
  if (configuration.modelProfileId === "")
    throw new AgentError("model_assignment_missing");
  const source = context.profiles.find(
    (entry) => entry.id === configuration.modelProfileId,
  );
  if (
    !source ||
    source.ownerId !== undefined ||
    !source.isActive ||
    !source.purposes.includes("agent") ||
    agentProfilePriority(source, viewer, "agent") === 0 ||
    (source.configuration?.projectId &&
      source.configuration.projectId !== context.projectId) ||
    source.model !== configuration.model
  )
    throw new AgentError("agent_usage_denied");
  const assignment = await resolveAgentAssignmentFor(
    dependencies.connections,
    viewer,
    {
      connectionId: source.connectionId,
      model: configuration.model,
      reasoningEffort: configuration.reasoningEffort,
    },
  );
  if (assignment.connection.provider !== configuration.provider)
    throw new AgentError("plan_context_changed");
  return { assignment, accessAgentId: source.id };
}

/** Rechecks model scopes before disclosing output, including legacy definition shares. */
export async function requirePlanModelResources(
  profiles: AgentProfileService,
  userId: string,
  resources: AgentPlanRunResources,
): Promise<void> {
  for (const connectionId of resources.connectionIds ?? [])
    await profiles.requireConnection(userId, connectionId);
  for (const agentId of resources.agentIds)
    if (!(await profiles.isVisible(userId, agentId)))
      throw new AgentError("plan_access_denied");
}
