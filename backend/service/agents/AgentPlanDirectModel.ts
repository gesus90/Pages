import { AgentError } from "@/backend/error/AgentErrors";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import { resolveAgentAssignmentFor } from "./AgentAssignmentResolution";

import type { AgentViewer } from "@/backend/auth/AgentProfilePolicy";
import type { AgentPlanConfiguration } from "@/definition/AgentPlanConfiguration";
import type { AgentProfile } from "@/definition/AgentProfile";
import type { ProfileDependencies } from "./AgentProfileService";
import type { ResolvedAgentAssignment } from "./AgentAssignmentResolution";

/** Resolves the node's own routing and runtime content without consulting a mutable template. */
export async function resolveDirectPlanModel(
  dependencies: ProfileDependencies,
  viewer: AgentViewer,
  selection: {
    readonly agentId: string;
    readonly configuration: AgentPlanConfiguration;
  },
): Promise<{
  readonly profile: AgentProfile;
  readonly accessAgentId: string;
  readonly assignment: ResolvedAgentAssignment;
}> {
  const { configuration } = selection;
  if (!configuration.connectionId)
    throw new AgentError("model_assignment_missing");
  const assignment = await resolveAgentAssignmentFor(
    dependencies.connections,
    viewer,
    {
      connectionId: configuration.connectionId,
      model: configuration.model,
      reasoningEffort: configuration.reasoningEffort,
    },
  );
  if (assignment.connection.provider !== configuration.provider)
    throw new AgentError("plan_context_changed");
  return {
    accessAgentId: configuration.connectionId,
    assignment,
    profile: {
      id: selection.agentId,
      name: configuration.name,
      revision: configuration.revision,
      connectionId: configuration.connectionId,
      model: configuration.model,
      reasoningEffort: configuration.reasoningEffort,
      isActive: true,
      purposes: ["agent"],
      targets: [],
      configuration: {
        ...emptyAgentConfiguration(),
        ...configuration.template,
      },
    },
  };
}
