import { randomUUID } from "node:crypto";

import { readAgentObject } from "@/backend/agents/AgentPayload";
import { readAgentConfiguration } from "@/backend/agents/AgentConfigurationInput";
import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { AgentError } from "@/backend/error/AgentErrors";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";
import { agentParameterIssues } from "@/definition/AgentParameters";
import { requireCredentialFreeText } from "@/backend/service/assistant/TextAssistantValidation";

import { pageAgentModels, resolvePageAgentModel } from "./PageAgentModels";

import type { AgentViewer } from "@/backend/auth/AgentProfilePolicy";
import type {
  AgentProfile,
  AgentProfileDirectory,
} from "@/definition/AgentProfile";
import type { PageAgent, PageAgentPage } from "@/definition/PageAgent";
import type {
  ProfileDependencies,
  AgentProfileService,
} from "./AgentProfileService";
import type { AgentDefinitionFiles } from "./AgentDefinitionFiles";

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
    const viewer = await this.viewer(userId);
    const [catalog, models, snapshot, groups] = await Promise.all([
      this.profiles.catalog(userId),
      pageAgentModels(this.dependencies, viewer),
      this.dependencies.authorization.snapshot(),
      this.dependencies.groups.findAll(),
    ]);
    const directory: AgentProfileDirectory = {
      persons: [],
      groups: groups.map((group) => ({ id: group.id, name: group.name })),
      departments: snapshot.departments,
    };
    const agents: PageAgent[] = [];
    for (const profile of await this.dependencies.profiles.list()) {
      const choice = catalog.find((entry) => entry.id === profile.id);
      if (
        !profile.ownerId ||
        !profile.modelProfileId ||
        !profile.configuration ||
        !choice
      )
        continue;
      agents.push({
        id: profile.id,
        ownerId: profile.ownerId,
        name: profile.name,
        modelProfileId: profile.modelProfileId,
        model: profile.model,
        reasoningEffort: profile.reasoningEffort,
        configuration: withoutDeletedTargets(profile.configuration, directory),
        revision: profile.revision,
        canEdit: profile.ownerId === userId,
        availability: choice.availability,
      });
    }
    return {
      isAdministrator: new UserPolicyService().isAdministrator(viewer.actor),
      agents,
      models,
      workspaces: (await this.dependencies.workspaces?.choices(userId)) ?? [],
      directory,
    };
  }

  /** Owner-only saves ignore client ownership, credentials, connections and model names. */
  public async save(
    userId: string,
    id: string | null,
    input: unknown,
  ): Promise<string> {
    return this.writes.run(async () => {
      const viewer = await this.viewer(userId);
      const previous =
        id === null
          ? undefined
          : (await this.dependencies.profiles.list()).find(
              (entry) => entry.id === id,
            );
      const proposed = readAgentObject(input);
      validateOwnerSave({ userId, id, previous, proposed });
      const name = readName(proposed.name);
      if (
        proposed.reasoningEffort !== null &&
        typeof proposed.reasoningEffort !== "string"
      )
        throw new AgentError("profile_invalid");
      const source = (await this.dependencies.profiles.list()).find(
        (entry) => entry.id === proposed.modelProfileId,
      );
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
      await resolvePageAgentModel(this.dependencies, viewer, profile);
      await this.files.save(profile, this.dependencies.profiles);
      return profile.id;
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
    if (!(await this.profiles.catalog(userId)).some((entry) => entry.id === id))
      throw new AgentError("agent_usage_denied");
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
