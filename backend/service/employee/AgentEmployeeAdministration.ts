import { randomUUID } from "node:crypto";

import { accountForChannel } from "@/backend/auth/McpActorContext";
import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { AdministrationError } from "@/backend/error/AdministrationError";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { UsernameTakenError } from "@/backend/error/UserErrors";
import { isAgentProvider } from "@/definition/AgentConnection";
import { CAPABILITY } from "@/definition/Authorization";

import {
  requireManagementTarget,
  requireManagementRole,
} from "../management/ManagementPolicy";
import { activeAccount, findAccount } from "../AdministrationAccess";
import { AgentAccessLevelChanges } from "./AgentAccessLevelChanges";
import { AgentEmployeeDirectory } from "./AgentEmployeeDirectory";
import { employeeChange } from "./AgentEmployeeInput";

import type { ActorChannel } from "@/backend/auth/McpActorContext";
import type {
  AuthorizationRepository,
  AuthorizationSnapshot,
} from "@/backend/database/repositories/AuthorizationRepository";
import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { AccountAccess, UserRole } from "@/definition/Authorization";
import type {
  AgentAccessEnvironment,
  AgentEmployee,
} from "@/definition/AgentEmployee";
import type { AgentEmployeeInput } from "./AgentEmployeeInput";
import type { AgentMemoryFile } from "./AgentMemoryService";
import type {
  AgentAvatarUpload,
  AgentEmployeeAdministrationDependencies,
  AgentEmployeeChoices,
  AgentEmployeeDetail,
  AgentEmployeePage,
  AgentEmployeeRemovalScope,
  AgentEmployeeUpdate,
} from "./AgentEmployeeAdministrationContracts";

export type {
  AgentAvatarUpload,
  AgentEmployeeAdministrationDependencies,
  AgentEmployeeChoices,
  AgentEmployeeDetail,
  AgentEmployeePage,
  AgentEmployeeRemovalScope,
  AgentEmployeeUpdate,
};

/** What a host without an access environment offers: no isolation, no server. */
const NO_ACCESS_ENVIRONMENT: AgentAccessEnvironment = {
  isIsolationAvailable: false,
  mcpServers: [],
};

function requireRole(
  snapshot: AuthorizationSnapshot,
  roleId: string,
): UserRole {
  const role = snapshot.roles.find((candidate) => candidate.id === roleId);
  if (!role) throw new AgentEmployeeError("invalidInput");
  return role;
}

function requireDepartments(
  snapshot: AuthorizationSnapshot,
  ids: readonly string[],
): void {
  if (
    ids.some(
      (id) => !snapshot.departments.some((department) => department.id === id),
    )
  )
    throw new AgentEmployeeError("invalidInput");
}

function sameDepartments(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length && left.every((id) => right.includes(id));
}

/** Refuses a change of an agent that works in a plan or a session right now. */
async function requireIdle(
  store: EmployeeStore,
  agentId: string,
): Promise<void> {
  if (await store.removals().isRunning(agentId))
    throw new AgentEmployeeError("busy");
}

/**
 * Creates, changes and removes agent employees in the user administration.
 * @remarks
 * Agents are managed like people: the same rights decide who may create,
 * see and change them, which role and departments they may get, and the
 * same checks of rank and range apply. An agent always has a normal role,
 * never the administrator account, no password and no sign-in. The model is
 * checked against the employee rule on the server before anything is stored.
 * The interface uses the `ui` channel; the MCP interface takes the copy of
 * {@link AgentEmployeeAdministration.forChannel} for `mcp`, on which an
 * account with the administrator role acts as an administrator.
 */
export class AgentEmployeeAdministration {
  private readonly channel: ActorChannel;
  private readonly dependencies: AgentEmployeeAdministrationDependencies;
  private readonly policy: UserPolicyService;
  private readonly directory: AgentEmployeeDirectory;
  private readonly accessLevels: AgentAccessLevelChanges;

  public constructor(
    dependencies: AgentEmployeeAdministrationDependencies,
    channel: ActorChannel = "ui",
  ) {
    this.channel = channel;
    this.dependencies = dependencies;
    this.policy = new UserPolicyService(channel);
    this.directory = new AgentEmployeeDirectory(dependencies);
    this.accessLevels = new AgentAccessLevelChanges(
      this.policy,
      dependencies.activity,
      dependencies.accessEnvironment,
    );
  }

  /** The same administration with the administrator reading of another channel. */
  public forChannel(channel: ActorChannel): AgentEmployeeAdministration {
    return new AgentEmployeeAdministration(this.dependencies, channel);
  }

  /**
   * Requires an active account that is an administrator on this channel.
   * @throws {AgentEmployeeError} `forbidden` for every other account.
   */
  public async requireAdministrator(actorId: string): Promise<void> {
    const snapshot = await this.dependencies.authorization.snapshot();
    const actor = snapshot.accounts.find(
      (account) => account.userId === actorId,
    );
    if (!actor || !this.policy.hasGlobalAccess(actor))
      throw new AgentEmployeeError("forbidden");
  }

  /** Every agent the person may see, with its full panel, by name. */
  public async employees(actorId: string): Promise<AgentEmployee[]> {
    const snapshot = await this.dependencies.authorization.snapshot();
    const actor = accountForChannel(
      activeAccount(snapshot, actorId),
      this.channel,
    );
    if (!this.policy.canEnter(actor)) throw new AgentEmployeeError("forbidden");
    const items = await this.directory.list(snapshot, (target) =>
      this.policy.canSee(actor, target),
    );
    const agents: AgentEmployee[] = [];
    for (const item of items)
      agents.push(
        await this.directory.detail(
          snapshot,
          this.requireAgentAccount(snapshot, item.id),
        ),
      );
    return agents;
  }

  /** The roles the person may assign and every department. */
  public async choices(actorId: string): Promise<AgentEmployeeChoices> {
    const snapshot = await this.dependencies.authorization.snapshot();
    const actor = accountForChannel(
      activeAccount(snapshot, actorId),
      this.channel,
    );
    this.require(this.policy.has(actor, CAPABILITY.MANAGE_USERS));
    return {
      roles: snapshot.roles.filter((role) =>
        this.policy.canAssignRole(actor, role),
      ),
      departments: snapshot.departments,
    };
  }

  /** The agents tab for a person who may enter the administration. */
  public async page(actorId: string): Promise<AgentEmployeePage> {
    const snapshot = await this.dependencies.authorization.snapshot();
    const actor = accountForChannel(
      activeAccount(snapshot, actorId),
      this.channel,
    );
    if (!this.policy.canEnter(actor)) throw new AgentEmployeeError("forbidden");
    const canCreate = this.policy.has(actor, CAPABILITY.MANAGE_USERS);
    return {
      agents: await this.directory.list(snapshot, (target) =>
        this.policy.canSee(actor, target),
      ),
      models: canCreate ? await this.dependencies.models.models(actorId) : [],
      canCreate,
    };
  }

  /** The panel of one agent the person may see. */
  public async detail(
    actorId: string,
    agentId: string,
  ): Promise<AgentEmployeeDetail> {
    const snapshot = await this.dependencies.authorization.snapshot();
    const actor = accountForChannel(
      activeAccount(snapshot, actorId),
      this.channel,
    );
    const target = this.requireAgentAccount(snapshot, agentId);
    if (!this.policy.canSee(actor, target))
      throw new AgentEmployeeError("notFound");
    const agent = await this.directory.detail(snapshot, target);
    const canEdit = this.policy.canChange(
      actor,
      target,
      CAPABILITY.MANAGE_USERS,
    );
    return {
      agent,
      memoryDetails: await this.dependencies.memory.details(agentId),
      activity: await this.dependencies.activity.list(agentId),
      canEdit,
      canChangeAccess: canEdit && this.policy.hasGlobalAccess(actor),
      canAssignYolo: this.policy.isAdministrator(actor),
      accessEnvironment:
        this.policy.isManagement(actor) && !this.policy.isAdministrator(actor)
          ? {
              isIsolationAvailable:
                (await this.dependencies.accessEnvironment?.isIsolationAvailable()) ??
                false,
              mcpServers: [],
            }
          : ((await this.dependencies.accessEnvironment?.environment(
              isAgentProvider(agent.provider) ? agent.provider : null,
            )) ?? NO_ACCESS_ENVIRONMENT),
    };
  }

  /**
   * The stored name of an agent whose voice the person may change.
   * @returns The display name the fixed sample sentence of the voice names.
   * @throws {AgentEmployeeError} `notFound` for an agent the person may not
   * see, `forbidden` without the right to change it.
   */
  public async voiceSampleName(
    actorId: string,
    agentId: string,
  ): Promise<string> {
    const snapshot = await this.dependencies.authorization.snapshot();
    const actor = accountForChannel(
      activeAccount(snapshot, actorId),
      this.channel,
    );
    const target = this.requireAgentAccount(snapshot, agentId);
    if (!this.policy.canSee(actor, target))
      throw new AgentEmployeeError("notFound");
    this.require(this.policy.canChange(actor, target, CAPABILITY.MANAGE_USERS));
    const user = await this.dependencies.authorization
      .users()
      .findById(agentId);
    if (!user) throw new AgentEmployeeError("notFound");
    return user.displayName;
  }

  /**
   * Creates an agent account with its configuration.
   * @returns The user ID of the new agent.
   * @throws {AgentEmployeeError} For a refused right, role, department or model.
   */
  public async create(
    actorId: string,
    input: AgentEmployeeInput,
    avatar: AgentAvatarUpload | null,
  ): Promise<string> {
    await this.dependencies.models.requireAllowed(actorId, input.settings);
    const agentId = randomUUID();
    await this.write(async (repository) => {
      const snapshot = await repository.snapshot();
      const actor = accountForChannel(
        activeAccount(snapshot, actorId),
        this.channel,
      );
      this.require(this.policy.has(actor, CAPABILITY.MANAGE_USERS));
      const role = requireRole(snapshot, input.roleId);
      requireManagementRole(actor, role.id);
      this.require(this.policy.canAssignRole(actor, role));
      await this.accessLevels.requireChange(
        actor,
        "read_only",
        input.settings.access,
      );
      const account = this.newAccount(agentId, role, input.displayName);
      if (input.departments.length > 0) {
        requireDepartments(snapshot, input.departments);
        this.require(
          this.policy.canSetMemberships(actor, account, input.departments),
        );
      }
      const store = repository.employees();
      await store.identities().insertAgent(agentId, {
        username: input.username,
        displayName: input.displayName,
        jobTitle: input.position,
        avatarColor: input.avatarColor,
      });
      await repository.saveAccount({
        ...account,
        departments: input.departments,
      });
      await store.employees().create(agentId, employeeChange(input));
      if (input.settings.access !== "read_only")
        await this.accessLevels.record(store, {
          agentId,
          actor,
          from: null,
          to: input.settings.access,
        });
      if (input.memory)
        await store.employees().saveMemory(agentId, input.memory);
      if (input.dream) await store.employees().saveDream(agentId, input.dream);
      await this.dependencies.memory.initialize(store, agentId, actorId);
      if (avatar) await this.storeAvatar(repository, agentId, avatar);
    });
    return agentId;
  }

  /**
   * Saves the panel of an agent when nobody changed it since it was read.
   * @throws {AgentEmployeeError} `conflict` for a stale revision, `busy` for
   * the deactivation of a running agent, or a refused right, role, department or model.
   */
  public async update(
    actorId: string,
    agentId: string,
    change: AgentEmployeeUpdate,
    avatar: AgentAvatarUpload | null,
  ): Promise<void> {
    await this.dependencies.models.requireAllowed(
      actorId,
      change.input.settings,
    );
    await this.write((repository) =>
      this.writeAgentUpdate(repository, actorId, agentId, { change, avatar }),
    );
    // A lowered limit applies at once.
    await this.dependencies.memory.fitToLimits(agentId);
  }

  /**
   * Activates or deactivates an agent when nobody changed it since it was read.
   * @remarks
   * Deactivation removes the agent from every group, as for a person, and
   * is refused while the agent works in a plan or a session.
   * @throws {AgentEmployeeError} `conflict` for a stale revision, `busy` for a running agent, `forbidden` or `notFound`.
   */
  public async setActive(
    actorId: string,
    agentId: string,
    change: { readonly isActive: boolean; readonly revision: number },
  ): Promise<void> {
    await this.write(async (repository) => {
      await this.requireChangeable(repository, actorId, agentId);
      if (
        !(await repository
          .employees()
          .employees()
          .touch(agentId, change.revision))
      )
        throw new AgentEmployeeError("conflict");
      await this.applyActive(repository, agentId, change.isActive);
    });
    this.dependencies.cache.invalidateWorkItems();
  }

  /**
   * Replaces the image of an agent with a validated upload.
   * @throws {AgentEmployeeError} `forbidden` or `notFound`.
   */
  public async setAvatar(
    actorId: string,
    agentId: string,
    avatar: AgentAvatarUpload,
  ): Promise<void> {
    await this.write(async (repository) => {
      await this.requireChangeable(repository, actorId, agentId);
      await this.storeAvatar(repository, agentId, avatar);
    });
  }

  /**
   * Removes the image of an agent; its initials show again.
   * @throws {AgentEmployeeError} `forbidden` or `notFound`.
   */
  public async removeAvatar(actorId: string, agentId: string): Promise<void> {
    await this.write(async (repository) => {
      await this.requireChangeable(repository, actorId, agentId);
      await repository.users().deleteAvatar(agentId);
    });
  }

  /**
   * Reads what the removal of an agent would take with it, changing nothing.
   * @throws {AgentEmployeeError} `forbidden` or `notFound`.
   */
  public async removalScope(
    actorId: string,
    agentId: string,
  ): Promise<AgentEmployeeRemovalScope> {
    const snapshot = await this.dependencies.authorization.snapshot();
    const actor = accountForChannel(
      activeAccount(snapshot, actorId),
      this.channel,
    );
    const target = this.requireAgentAccount(snapshot, agentId);
    requireManagementTarget(actor, target);
    this.require(this.policy.canChange(actor, target, CAPABILITY.MANAGE_USERS));
    const removals = this.dependencies.authorization.employees().removals();
    const [agent, usages, isRunning] = await Promise.all([
      this.directory.detail(snapshot, target),
      removals.usages(agentId),
      removals.isRunning(agentId),
    ]);
    return { agent, usages, isRunning };
  }

  /**
   * Removes an agent with its image, documents, memory, versions, archive,
   * memberships and chat list entries.
   * @remarks
   * Earlier contributions keep its name as their author; its tickets lose it
   * as the assignee.
   * @throws {AgentEmployeeError} `conflict` for a stale revision, `busy` for a running agent, `forbidden` or `notFound`.
   */
  public async remove(
    actorId: string,
    agentId: string,
    revision: number,
  ): Promise<void> {
    await this.write(async (repository) => {
      const actor = activeAccount(await repository.snapshot(), actorId);
      this.require(
        !this.policy.isManagement(actor) || this.policy.isAdministrator(actor),
      );
      await this.requireChangeable(repository, actorId, agentId);
      const store = repository.employees();
      const employee = await store.employees().find(agentId);
      if (!employee) throw new AgentEmployeeError("notFound");
      if (employee.revision !== revision)
        throw new AgentEmployeeError("conflict");
      await requireIdle(store, agentId);
      await store.removals().remove(agentId);
    });
    this.dependencies.cache.invalidateWorkItems();
  }

  /**
   * Restores a version of the memory of an agent the person may change.
   * @remarks
   * The version names the revision of the agent the person read; a `null`
   * revision restores without that check.
   * @throws {AgentEmployeeError} `forbidden`, `notFound` or `conflict`.
   */
  public async restoreMemory(
    actorId: string,
    agentId: string,
    version: { readonly id: string; readonly expectedRevision: number | null },
  ): Promise<void> {
    const snapshot = await this.dependencies.authorization.snapshot();
    const actor = accountForChannel(
      activeAccount(snapshot, actorId),
      this.channel,
    );
    const target = this.requireAgentAccount(snapshot, agentId);
    requireManagementTarget(actor, target);
    this.require(this.policy.canChange(actor, target, CAPABILITY.MANAGE_USERS));
    await this.dependencies.memory.restore(agentId, version, actorId);
  }

  /**
   * Empties `MEMORY.md` or `DREAM.md` of an agent the person may change;
   * the version before stays restorable.
   * @throws {AgentEmployeeError} `forbidden` or `notFound`.
   */
  public async resetMemory(
    actorId: string,
    agentId: string,
    file: AgentMemoryFile,
  ): Promise<void> {
    const snapshot = await this.dependencies.authorization.snapshot();
    const actor = accountForChannel(
      activeAccount(snapshot, actorId),
      this.channel,
    );
    const target = this.requireAgentAccount(snapshot, agentId);
    requireManagementTarget(actor, target);
    this.require(this.policy.canChange(actor, target, CAPABILITY.MANAGE_USERS));
    await this.dependencies.memory.reset(agentId, file, actorId);
  }

  /** Checks rights, role, departments and access level changes for an agent update. */
  private async requireAgentUpdateAccess(
    repository: AuthorizationRepository,
    actorId: string,
    agentId: string,
    input: AgentEmployeeUpdate["input"],
  ): Promise<{
    readonly actor: AccountAccess;
    readonly target: AccountAccess;
    readonly role: UserRole;
    readonly previousAccess: AgentEmployeeUpdate["input"]["settings"]["access"];
  }> {
    const snapshot = await repository.snapshot();
    const actor = accountForChannel(
      activeAccount(snapshot, actorId),
      this.channel,
    );
    const target = this.requireAgentAccount(snapshot, agentId);
    this.require(this.policy.canChange(actor, target, CAPABILITY.MANAGE_USERS));
    const role = requireRole(snapshot, input.roleId);
    if (!this.policy.isAdministrator(actor))
      requireManagementTarget(actor, target, role.id);
    if (role.id !== target.role?.id)
      this.require(
        this.policy.canChange(actor, target, CAPABILITY.MANAGE_ROLES) &&
          this.policy.canAssignRole(actor, role),
      );
    if (!sameDepartments(target.departments, input.departments)) {
      requireDepartments(snapshot, input.departments);
      this.require(
        this.policy.canSetMemberships(actor, target, input.departments),
      );
    }
    const previous = await repository.employees().employees().find(agentId);
    const previousAccess = previous?.access ?? "read_only";
    await this.accessLevels.requireChange(
      actor,
      previousAccess,
      input.settings.access,
    );
    this.accessLevels.requireToolGroupChange(
      actor,
      previous?.disabledToolGroups ?? [],
      input.settings.disabledToolGroups,
    );
    return { actor, target, role, previousAccess };
  }

  /** Persists the checked agent profile, role, access level, memory and avatar. */
  private async writeAgentUpdate(
    repository: AuthorizationRepository,
    actorId: string,
    agentId: string,
    payload: {
      readonly change: AgentEmployeeUpdate;
      readonly avatar: AgentAvatarUpload | null;
    },
  ): Promise<void> {
    const { change, avatar } = payload;
    const { input } = change;
    const { actor, target, role, previousAccess } =
      await this.requireAgentUpdateAccess(repository, actorId, agentId, input);
    const store = repository.employees();
    await store.identities().updateAgent(agentId, {
      username: input.username,
      displayName: input.displayName,
      jobTitle: input.position,
      avatarColor: input.avatarColor,
    });
    await repository.saveAccount({
      ...target,
      role,
      isAdmin: false,
      mode: "role",
      firstName: input.displayName,
      lastName: "",
      departments: input.departments,
    });
    const saved = await store
      .employees()
      .update(agentId, employeeChange(input), change.revision);
    if (!saved) throw new AgentEmployeeError("conflict");
    if (previousAccess !== input.settings.access)
      await this.accessLevels.record(store, {
        agentId,
        actor,
        from: previousAccess,
        to: input.settings.access,
      });
    for (const [file, text] of [
      ["memory", input.memory],
      ["dream", input.dream],
    ] as const)
      if (text !== null)
        await this.dependencies.memory.edit(store, {
          agentId,
          file,
          text,
          actorId,
        });
    if (avatar) await this.storeAvatar(repository, agentId, avatar);
    if (change.isActive !== undefined && change.isActive !== target.isActive)
      await this.applyActive(repository, agentId, change.isActive);
  }

  /** Runs an aggregate write and translates the shared refusals. */
  private async write(
    work: (repository: AuthorizationRepository) => Promise<void>,
  ): Promise<void> {
    try {
      await this.dependencies.authorization.transaction(work);
    } catch (error: unknown) {
      if (error instanceof UsernameTakenError)
        throw new AgentEmployeeError("usernameTaken");
      if (error instanceof AdministrationError)
        throw new AgentEmployeeError(
          error.code === "notFound" ? "notFound" : "forbidden",
        );
      throw error;
    }
    this.dependencies.cache.invalidateUsers();
    this.dependencies.cache.invalidateProjectMembership();
  }

  /** Requires an agent the person may change, inside an open transaction. */
  private async requireChangeable(
    repository: AuthorizationRepository,
    actorId: string,
    agentId: string,
  ): Promise<AccountAccess> {
    const snapshot = await repository.snapshot();
    const actor = accountForChannel(
      activeAccount(snapshot, actorId),
      this.channel,
    );
    const target = this.requireAgentAccount(snapshot, agentId);
    requireManagementTarget(actor, target);
    this.require(this.policy.canChange(actor, target, CAPABILITY.MANAGE_USERS));
    return target;
  }

  /** Activates an agent, or deactivates it when it does not work right now. */
  private async applyActive(
    repository: AuthorizationRepository,
    agentId: string,
    isActive: boolean,
  ): Promise<void> {
    if (!isActive) await requireIdle(repository.employees(), agentId);
    await repository.users().setActive(agentId, isActive);
  }

  private require(isAllowed: boolean): void {
    if (!isAllowed) throw new AgentEmployeeError("forbidden");
  }

  private requireAgentAccount(
    snapshot: AuthorizationSnapshot,
    agentId: string,
  ): AccountAccess {
    let account: AccountAccess;
    try {
      account = findAccount(snapshot, agentId);
    } catch (error: unknown) {
      if (error instanceof AdministrationError)
        throw new AgentEmployeeError("notFound");
      throw error;
    }
    if (account.isAgent !== true) throw new AgentEmployeeError("notFound");
    return account;
  }

  private newAccount(
    agentId: string,
    role: UserRole,
    displayName: string,
  ): AccountAccess {
    return {
      userId: agentId,
      role,
      isAdmin: false,
      mode: "role",
      firstName: displayName,
      lastName: "",
      isActive: true,
      departments: [],
      managedDepartments: [],
      allDepartments: false,
      allProjects: false,
      hasHadDepartment: false,
      isAgent: true,
    };
  }

  private async storeAvatar(
    repository: AuthorizationRepository,
    agentId: string,
    avatar: AgentAvatarUpload,
  ): Promise<void> {
    const users = repository.users();
    await users.upsertAvatar(agentId, avatar);
    await users.updateAvatarReference(agentId, {
      avatarType: "image",
      avatarImageUrl: `/users/${agentId}/avatar?v=${Date.now()}`,
    });
  }
}
