import { randomUUID } from "node:crypto";

import { readAgentObject } from "@/backend/agents/AgentPayload";
import { readAgentConfiguration } from "@/backend/agents/AgentConfigurationInput";
import { hasAgentUsage } from "@/backend/auth/AgentProfilePolicy";
import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { AgentError } from "@/backend/error/AgentErrors";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";
import { agentParameterIssues } from "@/definition/AgentParameters";
import { requireCredentialFreeText } from "@/backend/service/assistant/TextAssistantValidation";

import { pageAgentModels, resolvePageAgentModel } from "./PageAgentModels";

import type { AgentViewer } from "@/backend/auth/AgentProfilePolicy";
import type { AgentTicketChoice } from "@/definition/AgentParameters";
import type {
  AgentProfile,
  AgentProfileDirectory,
} from "@/definition/AgentProfile";
import type {
  PageAgent,
  PageAgentModel,
  PageAgentPage,
} from "@/definition/PageAgent";
import type {
  AgentProfileJournal,
  AgentProfileRemoveOptions,
} from "@/backend/database/repositories/agent/AgentProfileRepository";
import type {
  ProfileDependencies,
  AgentProfileService,
} from "./AgentProfileService";
import type { AgentDefinitionFiles } from "./AgentDefinitionFiles";

/** One person cannot fill the instance with agents; the lists and the files stay small. */
const MAX_AGENTS_PER_OWNER = 100;

/** User management uses the same persisted definitions and execution catalog as plans. */
export class PageAgentService {
  private readonly dependencies: ProfileDependencies;
  private readonly profiles: AgentProfileService;
  private readonly files: AgentDefinitionFiles;
  private readonly writes = new SerialQueue();

  public constructor(
    dependencies: ProfileDependencies,
    profiles: AgentProfileService,
    files: AgentDefinitionFiles,
  ) {
    this.dependencies = dependencies;
    this.profiles = profiles;
    this.files = files;
  }

  /** Loads visible definitions, current model grants and sharing directory names without account details. */
  public async page(userId: string): Promise<PageAgentPage> {
    const { viewer, stored, agents, directory } = await this.load(userId);
    return {
      isAdministrator: new UserPolicyService().isAdministrator(viewer.actor),
      agents,
      models: await pageAgentModels(this.dependencies, viewer, stored),
      workspaces: (await this.dependencies.workspaces?.choices(userId)) ?? [],
      directory,
    };
  }

  /**
   * Lists the user agents the person may currently see, with the names of their sharing targets.
   *
   * @param userId - Authenticated requester.
   *
   * @remarks
   * These are the agents of the page above: the owner's own and those shared
   * with the person. Agents of administrators are not part of it.
   */
  public async visibleAgents(userId: string): Promise<{
    readonly agents: readonly PageAgent[];
    readonly directory: AgentProfileDirectory;
  }> {
    const { agents, directory } = await this.load(userId);
    return { agents, directory };
  }

  /**
   * Lists the models the person may currently give an agent.
   *
   * @param userId - Authenticated requester.
   *
   * @remarks
   * Only models that administrators released for the person and whose
   * connection verifies right now are listed. No credential or connection
   * detail is part of an entry.
   */
  public async models(userId: string): Promise<readonly PageAgentModel[]> {
    const [viewer, stored] = await Promise.all([
      this.viewer(userId),
      this.dependencies.profiles.list(),
    ]);
    return pageAgentModels(this.dependencies, viewer, stored);
  }

  /** Supplies only currently accessible tickets for definition and plan parameter pickers. */
  public async ticketChoices(
    userId: string,
  ): Promise<readonly AgentTicketChoice[]> {
    await this.viewer(userId);
    if (!this.dependencies.tickets)
      throw new AgentError("parameter_ticket_unavailable");
    return this.dependencies.tickets.choices(userId);
  }

  /** Removes an owner's agent, checking live ownership before entering the definition's atomic mutation lock. */
  public async remove(
    userId: string,
    id: string,
    options: AgentProfileRemoveOptions = {},
  ): Promise<void> {
    await this.writes.run(async () => {
      await this.viewer(userId);
      const profile = (await this.dependencies.profiles.list()).find(
        (entry) => entry.id === id,
      );
      if (profile?.ownerId !== userId)
        throw new AgentError("agent_usage_denied");
      if (
        options.expectedRevision !== undefined &&
        profile.revision !== options.expectedRevision
      )
        throw new AgentError("profile_conflict");
      await this.files.remove(id, this.dependencies.profiles, options);
    });
  }

  /**
   * Owner-only saves ignore client ownership, credentials, connections and model names.
   *
   * @param userId - Authenticated requester, who becomes the owner of a new agent.
   * @param id - The agent to change, or `null` to create one.
   * @param input - The definition as received; it is validated here.
   * @param journal - Work that commits with the definition, in its transaction.
   * @returns The identifier of the saved agent.
   */
  public async save(
    userId: string,
    id: string | null,
    input: unknown,
    journal?: AgentProfileJournal,
  ): Promise<string> {
    return this.writes.run(() =>
      this.saveDefinition(userId, id, input, journal),
    );
  }

  /** Rechecks a clone's source in the same management queue as edits and deletion. */
  public async clone(
    userId: string,
    source: {
      readonly id: string;
      readonly expectedRevision: number;
      /** An explicit replacement may select the current grant; otherwise the pinned model is retained. */
      readonly preserveModel?: boolean;
    },
    input: unknown,
    journal?: AgentProfileJournal,
  ): Promise<string> {
    return this.writes.run(async () => {
      const viewer = await this.viewer(userId);
      const stored = await this.dependencies.profiles.list();
      const profile = stored.find((entry) => entry.id === source.id);
      if (!profile?.ownerId || !hasAgentUsage(profile, viewer))
        throw new AgentError("profile_not_found");
      if ((profile.revision ?? 1) !== source.expectedRevision)
        throw new AgentError("profile_conflict");
      const model = stored.find((entry) => entry.id === profile.modelProfileId);
      if (
        source.preserveModel !== false &&
        (!model ||
          model.connectionId !== profile.connectionId ||
          model.model !== profile.model)
      )
        throw new AgentError("agent_usage_denied");
      return this.saveDefinition(userId, null, input, journal);
    });
  }

  /**
   * Requires that the agent is currently visible to the user.
   *
   * @param userId - Authenticated requester.
   * @param id - Agent identifier from the request.
   * @throws {AgentError} `agent_usage_denied` for an agent that does not exist
   * and for one that is not shared with the user, without telling which.
   *
   * @remarks
   * Reading a record does not start a model, so the model grants are not part
   * of this check. A user who loses the share loses the content as well.
   */
  public async requireVisible(userId: string, id: string): Promise<void> {
    if (!(await this.profiles.isVisible(userId, id)))
      throw new AgentError("agent_usage_denied");
  }

  private async saveDefinition(
    userId: string,
    id: string | null,
    input: unknown,
    journal?: AgentProfileJournal,
  ): Promise<string> {
    const viewer = await this.viewer(userId);
    const stored = await this.dependencies.profiles.list();
    const previous =
      id === null ? undefined : stored.find((entry) => entry.id === id);
    const proposed = readAgentObject(input);
    validateOwnerSave({ userId, id, previous, proposed });
    if (
      id === null &&
      stored.filter((entry) => entry.ownerId === userId).length >=
        MAX_AGENTS_PER_OWNER
    )
      throw new AgentError("profile_limit_reached");
    const name = readName(proposed.name);
    if (
      proposed.reasoningEffort !== null &&
      typeof proposed.reasoningEffort !== "string"
    )
      throw new AgentError("profile_invalid");
    const source = stored.find((entry) => entry.id === proposed.modelProfileId);
    if (!source) throw new AgentError("agent_usage_denied");
    const configuration = readAgentConfiguration(proposed.configuration);
    await this.validateConfiguration(configuration);
    await this.validateReferences(viewer, configuration);
    requireCredentialFreeText(
      JSON.stringify({ name: proposed.name, configuration }),
    );
    const profile: AgentProfile = {
      id: id ?? randomUUID(),
      name,
      ownerId: userId,
      modelProfileId: source.id,
      connectionId: source.connectionId,
      model: source.model,
      reasoningEffort: proposed.reasoningEffort,
      isActive: true,
      purposes: ["agent"],
      targets: [],
      configuration: {
        ...configuration,
        scope: "person",
        accessMode: "shared",
      },
      revision: previous?.revision,
    };
    await resolvePageAgentModel(this.dependencies, viewer, profile, stored);
    await this.files.save(profile, this.dependencies.profiles, journal);
    return profile.id;
  }

  private async load(userId: string): Promise<{
    readonly viewer: AgentViewer;
    readonly stored: readonly AgentProfile[];
    readonly agents: readonly PageAgent[];
    readonly directory: AgentProfileDirectory;
  }> {
    const viewer = await this.viewer(userId);
    const [catalog, stored, snapshot, groups] = await Promise.all([
      this.profiles.catalog(userId),
      this.dependencies.profiles.list(),
      this.dependencies.authorization.snapshot(),
      this.dependencies.groups.findAll(),
    ]);
    const directory: AgentProfileDirectory = {
      persons: [],
      groups: groups.map((group) => ({ id: group.id, name: group.name })),
      departments: snapshot.departments,
    };
    const agents: PageAgent[] = [];
    for (const profile of stored) {
      const choice = catalog.find((entry) => entry.id === profile.id);
      if (!profile.ownerId || !profile.configuration || !choice) continue;
      const shown = withoutDeletedTargets(profile.configuration, directory);
      agents.push({
        id: profile.id,
        ownerId: profile.ownerId,
        name: profile.name,
        modelProfileId: profile.modelProfileId ?? "",
        model: profile.model,
        reasoningEffort: profile.reasoningEffort,
        configuration: shown,
        hasDeletedTargets:
          shown.sharing.targets.length <
          profile.configuration.sharing.targets.length,
        revision: profile.revision,
        canEdit: profile.ownerId === userId,
        availability: choice.availability,
      });
    }
    return { viewer, stored, agents, directory };
  }

  private async viewer(userId: string): Promise<AgentViewer> {
    const [snapshot, groupIds] = await Promise.all([
      this.dependencies.authorization.snapshot(),
      this.dependencies.groups.findIdsByMember(userId),
    ]);
    const actor = snapshot.accounts.find((entry) => entry.userId === userId);
    if (!actor?.isActive) throw new TextAssistantError("accessDenied");
    return { actor, groupIds };
  }

  private async validateConfiguration(
    configuration: PageAgent["configuration"],
  ): Promise<void> {
    if (
      configuration.projectId !== null ||
      agentParameterIssues(configuration).length > 0
    )
      throw new AgentError("configuration_invalid");
    const [groups, snapshot] = await Promise.all([
      this.dependencies.groups.findAll(),
      this.dependencies.authorization.snapshot(),
    ]);
    for (const target of configuration.sharing.targets) {
      if (target.kind !== "group" && target.kind !== "department")
        throw new AgentError("profile_target_invalid");
      const entries = target.kind === "group" ? groups : snapshot.departments;
      if (!entries.some((entry) => entry.id === target.targetId))
        throw new AgentError("profile_target_invalid");
    }
  }

  private async validateReferences(
    viewer: AgentViewer,
    configuration: PageAgent["configuration"],
  ): Promise<void> {
    for (const parameter of configuration.parameters) {
      const reference = parameter.defaultValue;
      if (reference?.type === "workspace") {
        if (!this.dependencies.workspaces)
          throw new AgentError("parameter_reference_unavailable");
        await this.dependencies.workspaces.resolve(
          viewer.actor.userId,
          reference.workspaceId,
        );
      }
      if (reference?.type === "wiki") {
        if (!this.dependencies.content)
          throw new AgentError("parameter_reference_unavailable");
        await this.dependencies.content.wiki(viewer.actor, reference.pageId);
      }
      if (reference?.type === "ticket") {
        if (!this.dependencies.tickets)
          throw new AgentError("parameter_ticket_unavailable");
        await this.dependencies.tickets.resolve(
          viewer.actor.userId,
          reference.ticketId,
        );
      }
    }
  }
}

/**
 * Leaves out sharing targets whose group or department no longer exists.
 *
 * @remarks
 * A deleted group never matches anyone, so the owner could not see why the
 * agent stays closed. The next save stores the cleaned list.
 */
function withoutDeletedTargets(
  configuration: PageAgent["configuration"],
  directory: AgentProfileDirectory,
): PageAgent["configuration"] {
  const known = new Set([
    ...directory.groups.map((entry) => `group:${entry.id}`),
    ...directory.departments.map((entry) => `department:${entry.id}`),
  ]);
  return {
    ...configuration,
    sharing: {
      ...configuration.sharing,
      targets: configuration.sharing.targets.filter((target) =>
        known.has(`${target.kind}:${target.targetId}`),
      ),
    },
  };
}

function readName(input: unknown): string {
  if (typeof input !== "string" || !input.trim() || input.length > 200)
    throw new AgentError("profile_invalid");
  return input.trim();
}

function validateOwnerSave(context: {
  readonly userId: string;
  readonly id: string | null;
  readonly previous: AgentProfile | undefined;
  readonly proposed: Readonly<Record<string, unknown>>;
}): void {
  if (context.id !== null && context.previous?.ownerId !== context.userId)
    throw new AgentError("agent_usage_denied");
  if (
    context.previous &&
    context.proposed.revision !== context.previous.revision
  )
    throw new AgentError("profile_conflict");
  if (typeof context.proposed.modelProfileId !== "string")
    throw new AgentError("profile_invalid");
}
