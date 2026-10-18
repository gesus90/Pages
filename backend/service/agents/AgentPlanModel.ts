import { agentProfilePriority } from "@/backend/auth/AgentProfilePolicy";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import { resolveAgentAssignmentFor } from "./AgentAssignmentResolution";

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
    return resolvePersonalModel(dependencies, viewer, configuration, context);
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

async function resolvePersonalModel(
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
  const candidates: {
    readonly assignment: ResolvedAgentAssignment;
    readonly accessAgentId: string;
  }[] = [];
  for (const source of context.profiles) {
    if (
      !source.targets.some(
        (target) =>
          target.kind === "person" && target.targetId === viewer.actor.userId,
      )
    )
      continue;
    try {
      candidates.push(
        await resolvePlanModel(
          dependencies,
          viewer,
          { ...configuration, modelProfileId: source.id },
          context,
        ),
      );
    } catch (error: unknown) {
      logCaughtError("AgentPlanModel", error);

      if (
        !(error instanceof AgentError) &&
        !(error instanceof AgentExecutionError)
      )
        throw error;
    }
  }
  if (candidates.length === 0) throw new AgentError("personal_access_missing");
  if (candidates.length > 1)
    throw new AgentError("personal_access_selection_required");
  return candidates[0];
}
