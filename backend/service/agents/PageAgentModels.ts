import { agentProfilePriority } from "@/backend/auth/AgentProfilePolicy";
import { AgentError } from "@/backend/error/AgentErrors";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";
import { logCaughtError } from "@/backend/logging/Logger";

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
 * user agent has no project and receives only global models. A plan may also
 * choose a grant bound to its own project.
 */
function isModelSource(
  source: AgentProfile,
  viewer: AgentViewer,
  projectId: string | null = null,
): boolean {
  return (
    source.ownerId === undefined &&
    source.isActive &&
    source.purposes.includes("agent") &&
    (!source.configuration?.projectId ||
      source.configuration.projectId === projectId) &&
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
  if (!profile.modelProfileId) throw new AgentError("model_assignment_missing");
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

/** The level an omitted reasoning effort takes when the model lists it. */
const PREFERRED_REASONING_EFFORT = "medium";

/**
 * The model an omitted `modelProfileId` selects.
 *
 * @param models - The models the person may use, in the order Pages lists them.
 * @returns The first model, which is also the one the agent form starts on, or
 * `null` when no model is released for the person.
 *
 * @remarks
 * Pages stores no separate default: what the administrators released for the
 * person is the configuration. There is no fallback to a model name.
 */
export function defaultPageAgentModel(
  models: readonly PageAgentModel[],
): PageAgentModel | null {
  return models.at(0) ?? null;
}

/**
 * The reasoning effort an omitted `reasoningEffort` takes for a model.
 *
 * @param model - A model from {@link pageAgentModels}.
 * @returns `medium` when the catalog lists it for the model, otherwise the
 * default the catalog names for the model when it is selectable, otherwise
 * `null`.
 *
 * @remarks
 * Nothing else is applied: a model that lists levels, none of them medium, and
 * names no default has no default effort, and the caller has to choose one.
 */
export function defaultReasoningEffort(
  model: Pick<
    PageAgentModel,
    "reasoningEfforts" | "catalogDefaultReasoningEffort"
  >,
): string | null {
  if (model.reasoningEfforts.includes(PREFERRED_REASONING_EFFORT))
    return PREFERRED_REASONING_EFFORT;
  const named = model.catalogDefaultReasoningEffort;
  return named !== null && model.reasoningEfforts.includes(named)
    ? named
    : null;
}

/** Enumerates exact administrative models after assignment, scope and capability checks. */
export async function pageAgentModels(
  dependencies: ProfileDependencies,
  viewer: AgentViewer,
  profiles: readonly AgentProfile[],
  projectId: string | null = null,
): Promise<readonly PageAgentModel[]> {
  const choices: PageAgentModel[] = [];
  for (const source of profiles) {
    if (!isModelSource(source, viewer, projectId)) continue;
    try {
      const { connection } = await resolveAgentAssignmentFor(
        dependencies.connections,
        viewer,
        source,
      );
      // The assignment above found this model in the catalog.
      const catalog = await dependencies.connections
        .catalogs()
        .find(source.connectionId);
      const listed = catalog.models.find((entry) => entry.id === source.model);
      choices.push({
        id: source.id,
        name: source.name,
        model: source.model,
        reasoning: listed?.reasoning ?? "unknown",
        reasoningEfforts: listed?.reasoningEfforts ?? [],
        catalogDefaultReasoningEffort: listed?.defaultReasoningEffort ?? null,
        reasoningEffort: source.reasoningEffort,
        provider: connection.provider,
      });
    } catch (error: unknown) {
      logCaughtError("PageAgentModels", error);

      if (!(error instanceof TextAssistantError)) throw error;
    }
  }
  return choices;
}
