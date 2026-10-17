import { configurationForTargets } from "@/backend/agents/AgentConfigurationInput";
import {
  agentProfilePriority,
  hasAgentUsage,
} from "@/backend/auth/AgentProfilePolicy";
import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { AgentError } from "@/backend/error/AgentErrors";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";
import {
  agentParameterIssues,
  scanAgentPlaceholders,
} from "@/definition/AgentParameters";
import { logCaughtError } from "@/backend/logging/Logger";

import { resolveAgentAssignmentFor } from "./AgentAssignmentResolution";
import { canUseAgentConnection } from "./AgentConnectionAccess";
import { resolvePlanModel } from "./AgentPlanModel";
import { pageAgentModels, resolvePageAgentModel } from "./PageAgentModels";

import type { PageAgentModel } from "@/definition/PageAgent";
import type { AgentViewer } from "@/backend/auth/AgentProfilePolicy";
import type {
  AgentAvailability,
  AgentDefinitionChoice,
  AgentDefinitionSelection,
} from "@/definition/AgentAvailability";
import type { AgentProfile } from "@/definition/AgentProfile";
import type { AgentConfiguration } from "@/definition/AgentConfiguration";
import type { ProfileDependencies } from "./AgentProfileService";
import type { ResolvedAgentAssignment } from "./AgentAssignmentResolution";

interface AvailabilityContext {
  readonly viewer: AgentViewer;
  readonly profiles: readonly AgentProfile[];
  readonly projectId: string | null;
}

/** Resolves reusable task access on the server, without provider requests or credential delegation. */
export class AgentAvailabilityService {
  private readonly dependencies: ProfileDependencies;

  public constructor(dependencies: ProfileDependencies) {
    this.dependencies = dependencies;
  }

  /** Lists only currently shared content in accessible projects, including blocked choices. */
  public async catalog(
    userId: string,
    projectId: string | null = null,
  ): Promise<readonly AgentDefinitionChoice[]> {
    const context = await this.context(userId, projectId);
    const choices: AgentDefinitionChoice[] = [];
    for (const profile of context.profiles) {
      if (!(await this.isListed(profile, context))) continue;
      const configuration =
        profile.configuration ?? configurationForTargets(profile.targets);
      const connection = await this.dependencies.connections.find(
        profile.connectionId,
      );
      choices.push({
        id: profile.id,
        modelProfileId: profile.modelProfileId ?? profile.id,
        name: profile.name,
        model: profile.model,
        reasoningEffort: profile.reasoningEffort,
        provider: connection?.provider ?? null,
        purposes: profile.purposes,
        revision: profile.revision ?? 1,
        configuration: visibleConfiguration(configuration),
        availability: await this.availability(profile, context),
      });
    }
    return choices;
  }

  /** Lists the released model choices for independent plan nodes. */
  public async models(
    userId: string,
    projectId: string | null = null,
  ): Promise<readonly PageAgentModel[]> {
    const context = await this.context(userId, projectId);
    return pageAgentModels(
      this.dependencies,
      context.viewer,
      context.profiles,
      projectId,
    );
  }

  /** Administration may inspect all agents, but gets no execution authorization bypass. */
  public async inspect(
    userId: string,
  ): Promise<Readonly<Record<string, AgentAvailability>>> {
    const context = await this.context(userId, null);
    if (!new UserPolicyService().isAdministrator(context.viewer.actor))
      throw new TextAssistantError("accessDenied");
    // The agents of users are none of the administration's business, not even their identifiers.
    const entries = await Promise.all(
      context.profiles
        .filter((profile) => !profile.ownerId)
        .map(
          async (profile) =>
            [profile.id, await this.availability(profile, context)] as const,
        ),
    );
    return Object.fromEntries(entries);
  }

  /** Whether the person currently sees the agent in their lists, without judging whether it can run. */
  public async isVisible(userId: string, agentId: string): Promise<boolean> {
    const context = await this.context(userId, null);
    const profile = context.profiles.find((entry) => entry.id === agentId);
    return profile !== undefined && (await this.isListed(profile, context));
  }

  /** Reauthorizes the selected definition and personal source for each future step start. */
  public async resolve(
    userId: string,
    selection: AgentDefinitionSelection,
  ): Promise<{
    readonly profile: AgentProfile;
    readonly accessAgentId: string;
    readonly assignment: ResolvedAgentAssignment;
  }> {
    const context = await this.context(userId, selection.projectId);
    const profile = context.profiles.find(
      (entry) => entry.id === selection.agentId,
    );
    if (
      !profile ||
      !profile.purposes.includes("agent") ||
      !hasAgentUsage(profile, context.viewer)
    )
      throw new AgentError("agent_usage_denied");
    if (!profile.isActive) throw new AgentError("agent_inactive");
    await this.requireProject(profile, context);
    if (selection.configuration) {
      const resolved = await resolvePlanModel(
        this.dependencies,
        context.viewer,
        selection.configuration,
        context,
      );
      return { profile, ...resolved };
    }
    const configuration =
      profile.configuration ?? configurationForTargets(profile.targets);
    if (scanAgentPlaceholders(configuration.markdown).hasUnsupportedRunNotes)
      throw new AgentError("run_notes_unsupported");
    if (agentParameterIssues(configuration).length > 0)
      throw new AgentError("parameter_invalid");
    if (profile.ownerId) {
      if (selection.personalAgentId !== null)
        throw new AgentError("agent_usage_denied");
      const { assignment, sourceId } = await resolvePageAgentModel(
        this.dependencies,
        context.viewer,
        profile,
        context.profiles,
      );
      return { profile, accessAgentId: sourceId, assignment };
    }
    if (configuration.accessMode === "shared") {
      if (
        selection.personalAgentId !== null ||
        agentProfilePriority(profile, context.viewer, "agent") === 0
      )
        throw new AgentError("agent_usage_denied");
      return {
        profile,
        accessAgentId: profile.id,
        assignment: await resolveAgentAssignmentFor(
          this.dependencies.connections,
          context.viewer,
          profile,
        ),
      };
    }
    const candidates = await this.personalCandidates(profile, context);
    const chosen = selectPersonalCandidate(
      candidates,
      selection.personalAgentId,
    );
    return {
      profile,
      accessAgentId: chosen.id,
      assignment: await resolveAgentAssignmentFor(
        this.dependencies.connections,
        context.viewer,
        chosen,
      ),
    };
  }

  /** Whether the person may see this agent: usage share, project context and connection scope. */
  private async isListed(
    profile: AgentProfile,
    context: AvailabilityContext,
  ): Promise<boolean> {
    if (
      !profile.purposes.includes("agent") ||
      !hasAgentUsage(profile, context.viewer)
    )
      return false;
    const configuration =
      profile.configuration ?? configurationForTargets(profile.targets);
    const { projectId } = configuration;
    if (
      projectId !== null &&
      (!(await this.canReadProject(context.viewer, projectId)) ||
        (context.projectId !== null && projectId !== context.projectId))
    )
      return false;
    // A personal agent runs on the person's own access, which is checked in
    // its availability; every other agent shows its model only within scope.
    return (
      profile.ownerId !== undefined ||
      configuration.accessMode === "personal" ||
      (await canUseAgentConnection(
        this.dependencies.connections,
        context.viewer,
        profile.connectionId,
      ))
    );
  }

  private async context(
    userId: string,
    projectId: string | null,
  ): Promise<AvailabilityContext> {
    const [snapshot, profiles, groupIds] = await Promise.all([
      this.dependencies.authorization.snapshot(),
      this.dependencies.profiles.list(),
      this.dependencies.groups.findIdsByMember(userId),
    ]);
    const actor = snapshot.accounts.find(
      (account) => account.userId === userId,
    );
    if (!actor?.isActive) throw new TextAssistantError("accessDenied");
    const viewer = { actor, groupIds };
    if (projectId !== null && !(await this.canReadProject(viewer, projectId)))
      throw new AgentError("agent_usage_denied");
    return { viewer, profiles, projectId };
  }

  private async canReadProject(
    viewer: AgentViewer,
    projectId: string,
  ): Promise<boolean> {
    return this.dependencies.content
      ? this.dependencies.content.canReadProject(viewer.actor, projectId)
      : false;
  }

  private async requireProject(
    profile: AgentProfile,
    context: AvailabilityContext,
  ): Promise<void> {
    const projectId = profile.configuration?.projectId;
    if (
      projectId &&
      (context.projectId !== projectId ||
        !(await this.canReadProject(context.viewer, projectId)))
    )
      throw new AgentError("agent_usage_denied");
  }

  private async availability(
    profile: AgentProfile,
    context: AvailabilityContext,
  ): Promise<AgentAvailability> {
    try {
      if (!profile.isActive) throw new AgentError("agent_inactive");
      if (!profile.purposes.includes("agent")) {
        if (
          !profile.purposes.some(
            (purpose) =>
              agentProfilePriority(profile, context.viewer, purpose) > 0,
          )
        )
          throw new AgentError("agent_usage_denied");
        await resolveAgentAssignmentFor(
          this.dependencies.connections,
          context.viewer,
          profile,
        );
        return { isUsable: true, reason: null, personalChoices: [] };
      }
      if (!hasAgentUsage(profile, context.viewer))
        throw new AgentError("agent_usage_denied");
      await this.requireProject(profile, context);
      const configuration =
        profile.configuration ?? configurationForTargets(profile.targets);
      if (scanAgentPlaceholders(configuration.markdown).hasUnsupportedRunNotes)
        throw new AgentError("run_notes_unsupported");
      if (agentParameterIssues(configuration).length > 0)
        throw new AgentError("parameter_invalid");
      if (profile.ownerId) {
        await resolvePageAgentModel(
          this.dependencies,
          context.viewer,
          profile,
          context.profiles,
        );
        return { isUsable: true, reason: null, personalChoices: [] };
      }
      if (configuration.accessMode === "personal") {
        const candidates = await this.personalCandidates(profile, context);
        if (candidates.length === 0)
          throw new AgentError("personal_access_missing");
        return {
          isUsable: true,
          reason: null,
          personalChoices: candidates.map((entry) => ({
            id: entry.id,
            name: entry.name,
            model: entry.model,
            reasoningEffort: entry.reasoningEffort,
          })),
        };
      }
      if (agentProfilePriority(profile, context.viewer, "agent") === 0)
        throw new AgentError("agent_usage_denied");
      await resolveAgentAssignmentFor(
        this.dependencies.connections,
        context.viewer,
        profile,
      );
      return { isUsable: true, reason: null, personalChoices: [] };
    } catch (error: unknown) {
      logCaughtError("AgentAvailabilityService", error);

      if (
        !(error instanceof AgentError) &&
        !(error instanceof TextAssistantError)
      )
        throw error;
      return { isUsable: false, reason: error.code, personalChoices: [] };
    }
  }

  private async personalCandidates(
    profile: AgentProfile,
    context: AvailabilityContext,
  ): Promise<readonly AgentProfile[]> {
    const requested = await this.dependencies.connections.find(
      profile.connectionId,
    );
    if (!requested) return [];
    const candidates: AgentProfile[] = [];
    for (const source of context.profiles.filter((entry) => !entry.ownerId)) {
      if (
        !source.isActive ||
        !source.purposes.includes("agent") ||
        source.model !== profile.model ||
        source.reasoningEffort !== profile.reasoningEffort ||
        !source.targets.some(
          (target) =>
            target.kind === "person" &&
            target.targetId === context.viewer.actor.userId,
        )
      )
        continue;
      if (
        source.configuration?.projectId &&
        source.configuration.projectId !== context.projectId
      )
        continue;
      const connection = await this.dependencies.connections.find(
        source.connectionId,
      );
      if (connection?.provider !== requested.provider) continue;
      try {
        await resolveAgentAssignmentFor(
          this.dependencies.connections,
          context.viewer,
          source,
        );
        candidates.push(source);
      } catch (error: unknown) {
        logCaughtError("AgentAvailabilityService", error);

        if (!(error instanceof TextAssistantError)) throw error;
      }
    }
    return candidates;
  }
}

function visibleConfiguration(
  configuration: AgentConfiguration,
): Omit<AgentConfiguration, "sharing"> {
  return {
    scope: configuration.scope,
    tag: configuration.tag,
    markdown: configuration.markdown,
    projectId: configuration.projectId,
    accessMode: configuration.accessMode,
    parameters: configuration.parameters,
    directoryParameter: configuration.directoryParameter,
    ...(configuration.run === undefined ? {} : { run: configuration.run }),
  };
}

function selectPersonalCandidate(
  candidates: readonly AgentProfile[],
  selectedId: string | null,
): AgentProfile {
  if (candidates.length === 0) throw new AgentError("personal_access_missing");
  if (selectedId === null && candidates.length > 1)
    throw new AgentError("personal_access_selection_required");
  const chosen =
    selectedId === null
      ? candidates[0]
      : candidates.find((entry) => entry.id === selectedId);
  if (!chosen) throw new AgentError("personal_access_missing");
  return chosen;
}
