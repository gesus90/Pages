import { randomUUID } from "node:crypto";

import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { agentProfilePriority } from "@/backend/auth/AgentProfilePolicy";
import { AgentError } from "@/backend/error/AgentErrors";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";
import { isAgentProfilePurpose } from "@/definition/AgentProfile";
import { matchesAgentFilters } from "@/definition/AgentFilters";
import { logCaughtError } from "@/backend/logging/Logger";

import {
  resolveAgentAssignment,
  resolveAgentAssignmentFor,
} from "./AgentAssignmentResolution";
import {
  readAgentProfileInput,
  requireAllowedRunOptions,
} from "./AgentProfileValidation";
import { requireAgentAdministrator } from "./AgentServiceAccess";
import { AgentAvailabilityService } from "./AgentAvailabilityService";

import type { PageAgentModel } from "@/definition/PageAgent";
import type { AgentViewer } from "@/backend/auth/AgentProfilePolicy";
import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import type { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AgentProfileRepository } from "@/backend/database/repositories/agent/AgentProfileRepository";
import type { AccountAccess } from "@/definition/Authorization";
import type {
  AgentConfiguration,
  AgentRunOptions,
} from "@/definition/AgentConfiguration";
import type {
  AgentProfile,
  AgentProfileInput,
  AgentProfileChoice,
  AgentProfileDirectory,
  AgentProfilePurpose,
  AgentProfileTarget,
} from "@/definition/AgentProfile";
import type { ResolvedAgentAssignment } from "./AgentAssignmentResolution";
import type { AgentOperationRegistry } from "./AgentOperationRegistry";
import type { AgentContentAccess } from "./AgentContentAccess";
import type { AgentWorkspaceService } from "./AgentWorkspaceService";
import type {
  AgentAvailability,
  AgentDefinitionChoice,
  AgentDefinitionSelection,
} from "@/definition/AgentAvailability";
import type { AgentFilters } from "@/definition/AgentFilters";
import type { AgentUsage } from "@/definition/AgentUsage";
import type { AgentDefinitionFiles } from "./AgentDefinitionFiles";
import type { AgentTicketParameterService } from "./AgentTicketParameterService";

/** Shared persistence and live authorization boundaries of the central agent aggregate. */
export interface ProfileDependencies {
  readonly profiles: AgentProfileRepository;
  readonly connections: AgentConnectionRepository;
  readonly authorization: AuthorizationRepository;
  readonly groups: UserGroupRepository;
  readonly operations: AgentOperationRegistry;
  readonly content?: AgentContentAccess;
  readonly workspaces?: AgentWorkspaceService;
  readonly files?: AgentDefinitionFiles;
  readonly tickets?: Pick<AgentTicketParameterService, "choices" | "resolve">;
}

/** Rechecks persisted grants at selection and execution; no admin execution bypass or fallback. */
export class AgentProfileService {
  private readonly dependencies: ProfileDependencies;
  private readonly writes = new SerialQueue();
  private readonly availability: AgentAvailabilityService;

  public constructor(dependencies: ProfileDependencies) {
    this.dependencies = dependencies;
    this.availability = new AgentAvailabilityService(dependencies);
  }

  /** Lists protected configuration for current administrators in admin mode. */
  public async list(actor: AccountAccess): Promise<readonly AgentProfile[]> {
    requireAgentAdministrator(await this.account(actor.userId));
    return (await this.dependencies.profiles.list()).filter(
      (profile) => !profile.ownerId,
    );
  }

  /** Names the agents of users, which the administration neither lists nor reports on. */
  public async userAgentIds(
    actor: AccountAccess,
  ): Promise<ReadonlySet<string>> {
    requireAgentAdministrator(await this.account(actor.userId));
    return new Set(
      (await this.dependencies.profiles.list())
        .filter((profile) => profile.ownerId !== undefined)
        .map((profile) => profile.id),
    );
  }

  /** Supplies current per-executor block reasons within protected administration. */
  public async inspect(
    actor: AccountAccess,
  ): Promise<Readonly<Record<string, AgentAvailability>>> {
    return this.availability.inspect(actor.userId);
  }

  /** Server filters operate only after current administrative access is established. */
  public async filteredList(
    actor: AccountAccess,
    filters: AgentFilters,
  ): Promise<{
    readonly profiles: readonly AgentProfile[];
    readonly availability: Readonly<Record<string, AgentAvailability>>;
  }> {
    const [profiles, availability] = await Promise.all([
      this.list(actor),
      this.inspect(actor),
    ]);
    const filtered: AgentProfile[] = [];
    for (const profile of profiles) {
      const connection = await this.dependencies.connections.find(
        profile.connectionId,
      );
      if (
        matchesAgentFilters(profile, {
          filters,
          provider: connection?.provider,
          availability: availability[profile.id],
        })
      )
        filtered.push(profile);
    }
    return { profiles: filtered, availability };
  }

  /** Provides the authorized read contract for A10.4 without introducing another management list. */
  public async catalog(
    userId: string,
    projectId: string | null = null,
  ): Promise<readonly AgentDefinitionChoice[]> {
    return this.availability.catalog(userId, projectId);
  }

  /** Lists currently released models for node-specific configuration. */
  public async planModels(
    userId: string,
    projectId: string | null = null,
  ): Promise<readonly PageAgentModel[]> {
    return this.availability.models(userId, projectId);
  }

  /** Whether the person currently sees the agent in their lists, without judging whether it can run. */
  public async isVisible(userId: string, agentId: string): Promise<boolean> {
    return this.availability.isVisible(userId, agentId);
  }

  /** Resolves only access and the template snapshot; starting runners belongs to A10.4. */
  public async resolveDefinition(
    userId: string,
    selection: AgentDefinitionSelection,
  ): Promise<{
    readonly profile: AgentProfile;
    readonly accessAgentId: string;
    readonly assignment: ResolvedAgentAssignment;
  }> {
    return this.availability.resolve(userId, selection);
  }

  /** Supplies protected live project choices without widening execution access. */
  public async projects(
    actor: AccountAccess,
  ): Promise<readonly { readonly id: string; readonly name: string }[]> {
    const account = await this.account(actor.userId);
    requireAgentAdministrator(account);
    return this.dependencies.content
      ? this.dependencies.content.projectChoices(account)
      : [];
  }

  /** Reports current references within protected administration. */
  public async usages(
    actor: AccountAccess,
    id: string,
  ): Promise<readonly AgentUsage[]> {
    requireAgentAdministrator(await this.account(actor.userId));
    return this.dependencies.profiles.usages(id);
  }

  /** Supplies names and identifiers only; credentials and account authorization stay server-side. */
  public async directory(actor: AccountAccess): Promise<AgentProfileDirectory> {
    requireAgentAdministrator(await this.account(actor.userId));
    const [snapshot, groups] = await Promise.all([
      this.dependencies.authorization.snapshot(),
      this.dependencies.groups.findAll(),
    ]);
    return {
      persons: snapshot.accounts.map((account) => ({
        id: account.userId,
        name:
          `${account.firstName} ${account.lastName}`.trim() || account.userId,
      })),
      groups: groups.map((group) => ({ id: group.id, name: group.name })),
      departments: snapshot.departments,
    };
  }

  /** Validates complete input and referenced directory targets before an atomic replacement. */
  public async save(
    actor: AccountAccess,
    id: string | null,
    input: unknown,
  ): Promise<string> {
    requireAgentAdministrator(await this.account(actor.userId));
    const profile = readAgentProfileInput(input);
    return this.writes.run(() =>
      this.dependencies.operations.run(
        profile.connectionId,
        "write",
        async () => {
          const previous = await this.previousForSave(id);
          const configured = mergeProfileInput(profile, previous);
          requireAgentAdministrator(await this.account(actor.userId));
          if (
            profile.revision !== undefined &&
            profile.revision !== previous?.revision
          )
            throw new AgentError("profile_conflict");
          const directory = await this.directory(actor);
          this.requireTargets(configured.targets, directory);
          if (configured.configuration) {
            this.requireTargets(
              configured.configuration.sharing.targets,
              directory,
            );
            await this.requireReferences(actor, configured.configuration);
            await this.requireRunOptions(
              profile.connectionId,
              configured.configuration.run,
              previous?.configuration?.run,
            );
          }
          if (
            !previous ||
            previous.connectionId !== profile.connectionId ||
            previous.model !== profile.model ||
            previous.reasoningEffort !== profile.reasoningEffort
          )
            await resolveAgentAssignment(
              this.dependencies.connections,
              profile,
            );
          const profileId = id ?? randomUUID();
          await this.persist({
            ...configured,
            id: profileId,
          });
          return profileId;
        },
      ),
    );
  }

  /** Administrators remove definitions and their live references in one transaction. */
  public async remove(actor: AccountAccess, id: string): Promise<void> {
    requireAgentAdministrator(await this.account(actor.userId));
    await this.writes.run(async () => {
      requireAgentAdministrator(await this.account(actor.userId));
      const profile = (await this.dependencies.profiles.list()).find(
        (entry) => entry.id === id,
      );
      if (!profile) throw new AgentError("profile_not_found");
      // Agents of users are managed by their owner only.
      if (profile.ownerId) throw new AgentError("agent_usage_denied");
      if (this.dependencies.files)
        await this.dependencies.files.removeWithReferences(
          id,
          this.dependencies.profiles,
        );
      else await this.dependencies.profiles.removeWithReferences(id);
    });
  }

  /** Offers only active, assigned profiles whose exact connection and capabilities still verify. */
  public async choices(
    userId: string,
    purpose: unknown,
  ): Promise<readonly AgentProfileChoice[]> {
    if (purpose === "agent")
      return (await this.catalog(userId))
        .filter((choice) => choice.availability.isUsable)
        .map((choice) => ({
          id: choice.id,
          name: choice.name,
          model: choice.model,
          reasoningEffort: choice.reasoningEffort,
        }));
    const { viewer, profiles: candidates } = await this.candidates(
      userId,
      purpose,
    );
    const choices: AgentProfileChoice[] = [];
    for (const profile of candidates) {
      if (!profile.isActive) continue;
      try {
        await resolveAgentAssignmentFor(
          this.dependencies.connections,
          viewer,
          profile,
        );
        choices.push({
          id: profile.id,
          name: profile.name,
          model: profile.model,
          reasoningEffort: profile.reasoningEffort,
        });
      } catch (error: unknown) {
        logCaughtError("AgentProfileService", error);

        if (!(error instanceof TextAssistantError)) throw error;
      }
    }
    return choices;
  }

  /** Pins an explicitly authorized profile, rejecting ambiguity and revoked selections. */
  public async resolve(
    userId: string,
    purpose: AgentProfilePurpose,
    profileId: string | null = null,
  ): Promise<ResolvedAgentAssignment> {
    if (purpose === "agent") {
      if (profileId === null)
        throw new TextAssistantError("profileSelectionRequired");
      return (
        await this.resolveDefinition(userId, {
          agentId: profileId,
          personalAgentId: null,
          projectId: null,
        })
      ).assignment;
    }
    if (profileId !== null) {
      const { viewer, profiles } = await this.candidates(userId, purpose);
      const profile = profiles.find((entry) => entry.id === profileId);
      if (!profile?.isActive) throw new TextAssistantError("accessDenied");
      const assignment = await resolveAgentAssignmentFor(
        this.dependencies.connections,
        viewer,
        profile,
      );
      // The run options travel with the assignment, so a CLI chat agent runs as administered (PAGE-90).
      const run = profile.configuration?.run;
      return run === undefined ? assignment : { ...assignment, run };
    }
    const { profiles: candidates } = await this.candidates(userId, purpose);
    if (candidates.length === 0) throw new TextAssistantError("roleMissing");
    if (candidates.length > 1)
      throw new TextAssistantError("profileSelectionRequired");
    return this.resolve(userId, purpose, candidates[0].id);
  }

  private async account(userId: string): Promise<AccountAccess> {
    const account = (
      await this.dependencies.authorization.snapshot()
    ).accounts.find((entry) => entry.userId === userId);
    if (!account?.isActive) throw new TextAssistantError("accessDenied");
    return account;
  }

  private async previousForSave(
    id: string | null,
  ): Promise<AgentProfile | null> {
    if (id === null) return null;
    const previous = (await this.dependencies.profiles.list()).find(
      (entry) => entry.id === id,
    );
    if (!previous) throw new AgentError("profile_not_found");
    if (previous.ownerId) throw new AgentError("agent_usage_denied");
    return previous;
  }

  private async persist(profile: AgentProfile): Promise<void> {
    if (this.dependencies.files)
      await this.dependencies.files.save(profile, this.dependencies.profiles);
    else await this.dependencies.profiles.save(profile);
  }

  private async candidates(
    userId: string,
    purpose: unknown,
  ): Promise<{
    readonly viewer: AgentViewer;
    readonly profiles: readonly AgentProfile[];
  }> {
    const actor = await this.account(userId);
    if (!isAgentProfilePurpose(purpose))
      throw new TextAssistantError("invalidInput");
    const [profiles, groups] = await Promise.all([
      this.dependencies.profiles.list(),
      this.dependencies.groups.findIdsByMember(userId),
    ]);
    const viewer = { actor, groupIds: groups };
    const assigned = profiles.filter(
      (profile) =>
        profile.purposes.includes(purpose) &&
        (purpose === "agent" || !profile.configuration?.projectId) &&
        agentProfilePriority(profile, viewer, purpose) > 0,
    );
    const priority = Math.max(
      0,
      ...assigned.map((profile) =>
        agentProfilePriority(profile, viewer, purpose),
      ),
    );
    return {
      viewer,
      profiles: assigned.filter(
        (profile) =>
          agentProfilePriority(profile, viewer, purpose) === priority,
      ),
    };
  }

  private requireTargets(
    targets: readonly AgentProfileTarget[],
    directory: AgentProfileDirectory,
  ): void {
    const collections = {
      person: directory.persons,
      group: directory.groups,
      department: directory.departments,
    };
    if (
      targets.some(
        (target) =>
          target.kind !== "system" &&
          !collections[target.kind].some(
            (entry) => entry.id === target.targetId,
          ),
      )
    )
      throw new AgentError("profile_target_invalid");
  }

  // Without a connection there is no runner whose options could be checked; it cannot run either.
  private async requireRunOptions(
    connectionId: string,
    run: AgentRunOptions | undefined,
    previous: AgentRunOptions | undefined,
  ): Promise<void> {
    const connection = await this.dependencies.connections.find(connectionId);
    if (connection)
      requireAllowedRunOptions(connection.provider, run, previous);
  }

  private async requireReferences(
    actor: AccountAccess,
    configuration: AgentConfiguration,
  ): Promise<void> {
    const account = await this.account(actor.userId);
    if (
      configuration.projectId !== null &&
      !(await this.dependencies.content?.canReadProject(
        account,
        configuration.projectId,
      ))
    )
      throw new AgentError("agent_usage_denied");
    for (const parameter of configuration.parameters) {
      if (parameter.defaultValue?.type === "ticket") {
        if (!this.dependencies.tickets)
          throw new AgentError("parameter_ticket_unavailable");
        await this.dependencies.tickets.resolve(
          account.userId,
          parameter.defaultValue.ticketId,
        );
      }
      if (parameter.defaultValue?.type === "workspace") {
        if (!this.dependencies.workspaces)
          throw new AgentError("parameter_reference_unavailable");
        await this.dependencies.workspaces.resolve(
          account.userId,
          parameter.defaultValue.workspaceId,
          configuration.projectId,
        );
      }
      if (parameter.defaultValue?.type === "wiki") {
        if (!this.dependencies.content)
          throw new AgentError("parameter_reference_unavailable");
        await this.dependencies.content.wiki(
          account,
          parameter.defaultValue.pageId,
        );
      }
    }
  }
}

function mergeProfileInput(
  input: AgentProfileInput,
  previous: AgentProfile | null | undefined,
): AgentProfileInput {
  return readAgentProfileInput({
    ...input,
    configuration: input.configuration ?? previous?.configuration,
    revision: input.revision ?? previous?.revision,
  });
}
