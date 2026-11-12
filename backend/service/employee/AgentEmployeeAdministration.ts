import { randomUUID } from "node:crypto";

import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { AdministrationError } from "@/backend/error/AdministrationError";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { UsernameTakenError } from "@/backend/error/UserErrors";
import { logEvent } from "@/backend/logging/Logger";
import { isAgentProvider } from "@/definition/AgentConnection";
import { CAPABILITY } from "@/definition/Authorization";

import { activeAccount, findAccount } from "../AdministrationAccess";
import { AgentEmployeeDirectory } from "./AgentEmployeeDirectory";

import type { ActorChannel } from "@/backend/auth/McpActorContext";
import type { ServerCache } from "@/backend/cache/ServerCache";
import type {
  AuthorizationRepository,
  AuthorizationSnapshot,
} from "@/backend/database/repositories/AuthorizationRepository";
import type { StoredUserAvatar } from "@/backend/database/repositories/UserRepository";
import type { AgentEmployeeChange } from "@/backend/database/repositories/employee/AgentEmployeeRepository";
import type { StoredAgentUsages } from "@/backend/database/repositories/employee/AgentEmployeeRemovalRepository";
import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type {
  AccountAccess,
  Department,
  UserRole,
} from "@/definition/Authorization";
import type {
  AgentAccessEnvironment,
  AgentEmployee,
  AgentEmployeeAccess,
} from "@/definition/AgentEmployee";
import type {
  AgentEmployeeDetailData,
  AgentEmployeePageData,
} from "@/definition/AgentEmployeePage";
import type { AgentAccessEnvironmentService } from "./AgentAccessEnvironmentService";
import type { AgentActivityService } from "./AgentActivityService";
import type { AgentEmployeeInput } from "./AgentEmployeeInput";
import type { AgentEmployeeModels } from "./AgentEmployeeModels";
import type { AgentMemoryFile, AgentMemoryService } from "./AgentMemoryService";

/** What the administration of agents is built from. */
export interface AgentEmployeeAdministrationDependencies {
  readonly authorization: AuthorizationRepository;
  readonly cache: Pick<
    ServerCache,
    "invalidateUsers" | "invalidateProjectMembership" | "invalidateWorkItems"
  >;
  readonly models: AgentEmployeeModels;
  readonly memory: AgentMemoryService;
  readonly activity: AgentActivityService;
  /** Isolation and MCP servers of the host for the access levels (PAGE-303); absent offers no isolation. */
  readonly accessEnvironment?: AgentAccessEnvironmentService;
}

/** What a host without an access environment offers: no isolation, no server. */
const NO_ACCESS_ENVIRONMENT: AgentAccessEnvironment = {
  isIsolationAvailable: false,
  mcpServers: [],
};

/** The agents tab: rows, the model choice and whether the person may create. */
export type AgentEmployeePage = Omit<
  AgentEmployeePageData,
  "templates" | "voice"
>;

/** Everything the panel of one agent shows. */
export type AgentEmployeeDetail = AgentEmployeeDetailData;

/** A new avatar image, already validated. */
export type AgentAvatarUpload = StoredUserAvatar;

/** The roles and departments a person may give an agent. */
export interface AgentEmployeeChoices {
  readonly roles: readonly UserRole[];
  readonly departments: readonly Department[];
}

/** What a removal would take with it, read before the person confirms it. */
export interface AgentEmployeeRemovalScope {
  readonly agent: AgentEmployee;
  readonly usages: StoredAgentUsages;
  /** A running agent cannot be removed or deactivated. */
  readonly isRunning: boolean;
}

/** A save of the agent panel, with the revision it was read at. */
export interface AgentEmployeeUpdate {
  readonly input: AgentEmployeeInput;
  readonly revision: number;
  /** Activates or deactivates the agent in the same change; absent leaves it. */
  readonly isActive?: boolean;
}

function employeeChange(input: AgentEmployeeInput): AgentEmployeeChange {
  return {
    connectionId: input.settings.connectionId,
    model: input.settings.model,
    reasoningEffort: input.settings.reasoningEffort,
    access: input.settings.access,
    soul: input.documents.soul,
    instructions: input.documents.instructions,
    isLearningEnabled: input.isLearningEnabled,
    voiceId: input.voice.voiceId,
    voiceSpeedTenths: input.voice.speedTenths,
    memoryCharacters: input.limits.memoryCharacters,
    dreamCharacters: input.limits.dreamCharacters,
  };
}

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

function actorName(actor: AccountAccess): string {
  return `${actor.firstName} ${actor.lastName}`.trim();
}

/**
 * Creates, changes and removes agent employees in the user administration
 * (PAGE-266, PAGE-267).
 *
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
  private readonly dependencies: AgentEmployeeAdministrationDependencies;
  private readonly policy: UserPolicyService;
  private readonly directory: AgentEmployeeDirectory;

  public constructor(
    dependencies: AgentEmployeeAdministrationDependencies,
    channel: ActorChannel = "ui",
  ) {
    this.dependencies = dependencies;
    this.policy = new UserPolicyService(channel);
    this.directory = new AgentEmployeeDirectory(dependencies);
  }

  /** The same administration with the administrator reading of another channel. */
  public forChannel(channel: ActorChannel): AgentEmployeeAdministration {
    return new AgentEmployeeAdministration(this.dependencies, channel);
  }

  /**
   * Requires an active account that is an administrator on this channel.
   *
   * @throws {AgentEmployeeError} `forbidden` for every other account.
   */
  public async requireAdministrator(actorId: string): Promise<void> {
    const snapshot = await this.dependencies.authorization.snapshot();
    const actor = snapshot.accounts.find(
      (account) => account.userId === actorId,
    );
    if (!actor || !this.policy.isAdministrator(actor))
      throw new AgentEmployeeError("forbidden");
  }

  /** Every agent the person may see, with its full panel, by name. */
  public async employees(actorId: string): Promise<AgentEmployee[]> {
    const snapshot = await this.dependencies.authorization.snapshot();
    const actor = activeAccount(snapshot, actorId);
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
    const actor = activeAccount(snapshot, actorId);
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
    const actor = activeAccount(snapshot, actorId);
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
    const actor = activeAccount(snapshot, actorId);
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
      canChangeAccess: canEdit && this.policy.isAdministrator(actor),
      accessEnvironment:
        (await this.dependencies.accessEnvironment?.environment(
          isAgentProvider(agent.provider) ? agent.provider : null,
        )) ?? NO_ACCESS_ENVIRONMENT,
    };
  }

  /**
   * The stored name of an agent whose voice the person may change (PAGE-300).
   *
   * @returns The display name the fixed sample sentence of the voice names.
   * @throws {AgentEmployeeError} `notFound` for an agent the person may not
   * see, `forbidden` without the right to change it.
   */
  public async voiceSampleName(
    actorId: string,
    agentId: string,
  ): Promise<string> {
    const snapshot = await this.dependencies.authorization.snapshot();
    const actor = activeAccount(snapshot, actorId);
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
   *
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
      const actor = activeAccount(snapshot, actorId);
      this.require(this.policy.has(actor, CAPABILITY.MANAGE_USERS));
      const role = requireRole(snapshot, input.roleId);
      this.require(this.policy.canAssignRole(actor, role));
      await this.requireAccessChange(actor, "read_only", input.settings.access);
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
        await this.recordAccessChange(store, {
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
   *
   * @throws {AgentEmployeeError} `conflict` for a stale revision, `busy` for
   * the deactivation of a running agent, or a refused right, role, department or model.
   */
  public async update(
    actorId: string,
    agentId: string,
    change: AgentEmployeeUpdate,
    avatar: AgentAvatarUpload | null,
  ): Promise<void> {
    const { input } = change;
    await this.dependencies.models.requireAllowed(actorId, input.settings);
    await this.write(async (repository) => {
      const snapshot = await repository.snapshot();
      const actor = activeAccount(snapshot, actorId);
      const target = this.requireAgentAccount(snapshot, agentId);
      this.require(
        this.policy.canChange(actor, target, CAPABILITY.MANAGE_USERS),
      );
      const role = requireRole(snapshot, input.roleId);
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
      const store = repository.employees();
      const previousAccess =
        (await store.employees().find(agentId))?.access ?? "read_only";
      await this.requireAccessChange(
        actor,
        previousAccess,
        input.settings.access,
      );
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
      if (
        !(await store
          .employees()
          .update(agentId, employeeChange(input), change.revision))
      )
        throw new AgentEmployeeError("conflict");
      if (previousAccess !== input.settings.access)
        await this.recordAccessChange(store, {
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
    });
    // A lowered limit applies at once (PAGE-305).
    await this.dependencies.memory.fitToLimits(agentId);
  }

  /**
   * Activates or deactivates an agent when nobody changed it since it was read.
   *
   * @remarks
   * Deactivation removes the agent from every group, as for a person, and
   * is refused while the agent works in a plan or a session.
   *
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
   *
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
   *
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
   *
   * @throws {AgentEmployeeError} `forbidden` or `notFound`.
   */
  public async removalScope(
    actorId: string,
    agentId: string,
  ): Promise<AgentEmployeeRemovalScope> {
    const snapshot = await this.dependencies.authorization.snapshot();
    const actor = activeAccount(snapshot, actorId);
    const target = this.requireAgentAccount(snapshot, agentId);
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
   *
   * @remarks
   * Earlier contributions keep its name as their author; its tickets lose it
   * as the assignee.
   *
   * @throws {AgentEmployeeError} `conflict` for a stale revision, `busy` for a running agent, `forbidden` or `notFound`.
   */
  public async remove(
    actorId: string,
    agentId: string,
    revision: number,
  ): Promise<void> {
    await this.write(async (repository) => {
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
   *
   * @remarks
   * The version names the revision of the agent the person read; a `null`
   * revision restores without that check.
   *
   * @throws {AgentEmployeeError} `forbidden`, `notFound` or `conflict`.
   */
  public async restoreMemory(
    actorId: string,
    agentId: string,
    version: { readonly id: string; readonly expectedRevision: number | null },
  ): Promise<void> {
    const snapshot = await this.dependencies.authorization.snapshot();
    const actor = activeAccount(snapshot, actorId);
    const target = this.requireAgentAccount(snapshot, agentId);
    this.require(this.policy.canChange(actor, target, CAPABILITY.MANAGE_USERS));
    await this.dependencies.memory.restore(agentId, version, actorId);
  }

  /**
   * Empties `MEMORY.md` or `DREAM.md` of an agent the person may change
   * (PAGE-305); the version before stays restorable.
   *
   * @throws {AgentEmployeeError} `forbidden` or `notFound`.
   */
  public async resetMemory(
    actorId: string,
    agentId: string,
    file: AgentMemoryFile,
  ): Promise<void> {
    const snapshot = await this.dependencies.authorization.snapshot();
    const actor = activeAccount(snapshot, actorId);
    const target = this.requireAgentAccount(snapshot, agentId);
    this.require(this.policy.canChange(actor, target, CAPABILITY.MANAGE_USERS));
    await this.dependencies.memory.reset(agentId, file, actorId);
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
    const actor = activeAccount(snapshot, actorId);
    const target = this.requireAgentAccount(snapshot, agentId);
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

  /**
   * Refuses a change of the access level by anyone but an administrator in
   * active admin mode, and "Arbeitsplatz" on a host without the isolation
   * it runs in (PAGE-303). An unchanged level needs neither.
   */
  private async requireAccessChange(
    actor: AccountAccess,
    from: AgentEmployeeAccess,
    to: AgentEmployeeAccess,
  ): Promise<void> {
    if (from === to) return;
    if (!this.policy.isAdministrator(actor))
      throw new AgentEmployeeError("accessAdminRequired");
    if (
      to === "workspace" &&
      !(await this.dependencies.accessEnvironment?.isIsolationAvailable())
    )
      throw new AgentEmployeeError("isolationUnavailable");
  }

  /** Records a change of the access level in the agent's activity and the server log. */
  private async recordAccessChange(
    store: EmployeeStore,
    change: {
      readonly agentId: string;
      readonly actor: AccountAccess;
      readonly from: AgentEmployeeAccess | null;
      readonly to: AgentEmployeeAccess;
    },
  ): Promise<void> {
    await this.dependencies.activity.recordAccessChange(store, {
      agentId: change.agentId,
      from: change.from,
      to: change.to,
      actorId: change.actor.userId,
      actorName: actorName(change.actor),
    });
    logEvent({
      level: "info",
      event: "agent.access.changed",
      component: "AgentEmployeeAdministration",
      message: "Access level of an agent changed",
      metadata: {
        agentId: change.agentId,
        actorId: change.actor.userId,
        from: change.from,
        to: change.to,
      },
    });
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
