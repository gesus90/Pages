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
 * Resolves the unchanged admin model and its live assignment independently of the usage share.
 *
 * @returns The assignment and the identifier of the administrator profile that grants it.
 * @throws {AgentError} `agent_usage_denied` unless the model profile is active, has
 * the purpose Agent, is released for the viewer and still names the saved model.
 */
export async function resolvePageAgentModel(
  dependencies: ProfileDependencies,
  viewer: AgentViewer,
  profile: AgentProfile,
): Promise<{
  readonly assignment: ResolvedAgentAssignment;
  readonly sourceId: string;
}> {
  const source = (await dependencies.profiles.list()).find(
    (entry) => entry.id === profile.modelProfileId,
  );
  if (
    !source ||
    source.ownerId ||
    !source.isActive ||
    !source.purposes.includes("agent") ||
    agentProfilePriority(source, viewer, "agent") === 0
  )
    throw new AgentError("agent_usage_denied");
  if (
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
): Promise<readonly PageAgentModel[]> {
  const choices: PageAgentModel[] = [];
  for (const source of await dependencies.profiles.list()) {
    if (
      source.ownerId ||
      !source.isActive ||
      !source.purposes.includes("agent") ||
      agentProfilePriority(source, viewer, "agent") === 0
    )
      continue;
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
