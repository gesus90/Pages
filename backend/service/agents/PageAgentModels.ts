import { agentProfilePriority } from "@/backend/auth/AgentProfilePolicy";
import { AgentError } from "@/backend/error/AgentErrors";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";

import { resolveAgentAssignmentFor } from "./AgentAssignmentResolution";

import type { AgentViewer } from "@/backend/auth/AgentProfilePolicy";
import type { AgentProfile } from "@/definition/AgentProfile";
import type { PageAgentModel } from "@/definition/PageAgent";
import type { ProfileDependencies } from "./AgentProfileService";
import type { ResolvedAgentAssignment } from "./AgentAssignmentResolution";

/**
 * Whether a profile of the administrators may serve as the model of a user agent for the viewer.
 *
 * @remarks
 * It must be active, have the purpose Agent and be released for the viewer. A
 * profile bound to a project is left out: an agent of a user has no project, so
 * it would run the model in every project.
 */
function isModelSource(source: AgentProfile, viewer: AgentViewer): boolean {
  return (
    source.ownerId === undefined &&
    source.isActive &&
    source.purposes.includes("agent") &&
    !source.configuration?.projectId &&
    agentProfilePriority(source, viewer, "agent") > 0
  );
}

/**
 * Resolves the unchanged admin model and its live assignment independently of the usage share.
 *
 * @param dependencies - Persistence and live authorization boundaries.
 * @param viewer - The person who saves or starts the agent.
 * @param profile - The user agent, naming its model profile, connection and model.
 * @param profiles - Every stored profile, as the caller already loaded them.
 * @returns The assignment and the identifier of the administrator profile that grants it.
 * @throws {AgentError} `agent_usage_denied` unless the model profile is released
 * for the viewer and still names the saved connection and model.
 */
export async function resolvePageAgentModel(
  dependencies: ProfileDependencies,
  viewer: AgentViewer,
  profile: AgentProfile,
  profiles: readonly AgentProfile[],
): Promise<{
  readonly assignment: ResolvedAgentAssignment;
  readonly sourceId: string;
}> {
  const source = profiles.find((entry) => entry.id === profile.modelProfileId);
  if (
    !source ||
    !isModelSource(source, viewer) ||
    source.connectionId !== profile.connectionId ||
    source.model !== profile.model
  )
    throw new AgentError("agent_usage_denied");
  return {
    assignment: await resolveAgentAssignmentFor(
      dependencies.connections,
      viewer,
      profile,
    ),
    sourceId: source.id,
  };
}

/** Enumerates exact administrative models after assignment, scope and capability checks. */
export async function pageAgentModels(
  dependencies: ProfileDependencies,
  viewer: AgentViewer,
  profiles: readonly AgentProfile[],
): Promise<readonly PageAgentModel[]> {
  const choices: PageAgentModel[] = [];
  for (const source of profiles) {
    if (!isModelSource(source, viewer)) continue;
    try {
      await resolveAgentAssignmentFor(dependencies.connections, viewer, source);
      // The assignment above found this model in the catalog.
      const catalog = await dependencies.connections
        .catalogs()
        .find(source.connectionId);
      choices.push({
        id: source.id,
        name: source.name,
        model: source.model,
        reasoningEfforts: catalog.models
          .filter((entry) => entry.id === source.model)
          .flatMap((entry) => entry.reasoningEfforts),
        reasoningEffort: source.reasoningEffort,
      });
    } catch (error: unknown) {
      if (!(error instanceof TextAssistantError)) throw error;
    }
  }
  return choices;
}
