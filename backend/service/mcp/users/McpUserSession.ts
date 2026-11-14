import { createHash } from "node:crypto";

import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { CAPABILITY } from "@/definition/Authorization";
import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { ServerCache } from "@/backend/cache/ServerCache";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { AdministrationService } from "@/backend/service/AdministrationService";
import { GroupAdministrationService } from "@/backend/service/GroupAdministrationService";
import { agentTransactionScope } from "@/backend/service/agents/AgentTransactionScope";

import { McpUserError } from "./McpUserError";

import type { PasswordHasher } from "@/backend/auth/PasswordHasher";
import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AuthorizationSnapshot } from "@/backend/database/repositories/AuthorizationRepository";
import type {
  AccountAccess,
  Capability,
  Department,
  UserRole,
} from "@/definition/Authorization";
import type { UserGroup } from "@/definition/UserGroup";
import type { McpUserConfirmation } from "./McpUserError";

/** The words a person types to confirm, as the administration contract names them. */
export const MCP_USER_CONFIRMATION_WORDS = ["LÖSCHEN", "DELETE"] as const;

/** Requires a policy decision or answers `forbidden`. */
export function requireMcpUserRight(isAllowed: boolean): void {
  if (!isAllowed) throw new McpUserError("forbidden");
}

/**
 * Requires the state the client read before it changes anything.
 *
 * @param current - The stored state, arrays already in a fixed order.
 * @param expected - The state the client read, in the same order.
 * @throws {McpUserError} `conflict` when they differ.
 */
export function requireMcpUserCurrent(
  current: unknown,
  expected: unknown,
): void {
  if (JSON.stringify(current) !== JSON.stringify(expected))
    throw new McpUserError("conflict");
}

/**
 * Requires the confirmation a person typed, for a reduction or a destructive change.
 *
 * @param confirmation - The reply the client passed; the model never invents it.
 * @param question - Target, effects and affected people of the change.
 * @throws {McpUserError} `confirmation_required` with the question.
 */
export function requireMcpUserConfirmation(
  confirmation: string | undefined,
  question: Omit<McpUserConfirmation, "words">,
): void {
  if (MCP_USER_CONFIRMATION_WORDS.some((word) => word === confirmation)) return;
  throw new McpUserError("confirmation_required", {
    ...question,
    words: MCP_USER_CONFIRMATION_WORDS,
  });
}

/** Sorts identifiers for a comparison independent of their order. */
export function sortedIds(ids: readonly string[]): readonly string[] {
  return [...ids].sort();
}

/**
 * Everything one request of the user management API works with, read inside
 * its transaction: the actor's current facts, the policy of the MCP channel
 * and the administration services of the interface.
 *
 * @remarks
 * Every call opens a new session, so revoked rights, a deactivation or a
 * forced password change count at once, for a repeated operation as well.
 * The services get a disabled cache; the API invalidates the shared cache
 * once the transaction committed.
 */
export class McpUserSession {
  public readonly database: DatabaseTransaction;
  public readonly repository: AuthorizationRepository;
  public readonly snapshot: AuthorizationSnapshot;
  public readonly actor: AccountAccess;
  public readonly policy: UserPolicyService;
  public readonly administration: AdministrationService;
  public readonly groups: GroupAdministrationService;

  private constructor(
    state: Pick<
      McpUserSession,
      "database" | "repository" | "snapshot" | "actor"
    >,
    hasher: PasswordHasher,
  ) {
    const cache = ServerCache.disabled();
    this.database = state.database;
    this.repository = state.repository;
    this.snapshot = state.snapshot;
    this.actor = state.actor;
    this.policy = new UserPolicyService("mcp");
    this.administration = new AdministrationService(
      state.repository,
      cache,
      hasher,
      "mcp",
    );
    this.groups = new GroupAdministrationService(
      state.repository,
      cache,
      "mcp",
    );
  }

  /**
   * Reads the actor's facts inside a transaction.
   *
   * @param database - The open transaction of the call.
   * @param userId - The account of the device token.
   * @param hasher - Hashes the temporary passwords the administration sets.
   * @throws {McpUserError} `invalid_token` when the account is gone or inactive.
   */
  public static async open(
    database: DatabaseTransaction,
    userId: string,
    hasher: PasswordHasher,
  ): Promise<McpUserSession> {
    const repository = new AuthorizationRepository(
      agentTransactionScope(database),
    );
    const snapshot = await repository.snapshot();
    const actor = snapshot.accounts.find(
      (account) => account.userId === userId,
    );
    if (actor === undefined || !actor.isActive)
      throw new McpUserError("invalid_token");
    return new McpUserSession(
      { database, repository, snapshot, actor },
      hasher,
    );
  }

  /** Whether the actor is an administrator by personal eligibility, regardless of the interface mode. */
  public get isAdministrator(): boolean {
    return this.policy.isAdministrator(this.actor);
  }

  /** Requires access to the user management: `manage_users`, `manage_roles` or `manage_departments`. */
  public requireManagement(): void {
    requireMcpUserRight(this.policy.canEnter(this.actor));
  }

  /** Requires one capability of the actor's role, or the administrator. */
  public requireCapability(capability: Capability): void {
    if (
      this.policy.isManagement(this.actor) &&
      !this.policy.has(this.actor, capability)
    )
      throw new AgentOperationError("FORBIDDEN", {
        reason:
          capability === CAPABILITY.MANAGE_ROLES ? "role_grant" : "core_system",
      });
    requireMcpUserRight(this.policy.has(this.actor, capability));
  }

  /** Requires current personal administrator eligibility. */
  public requireAdministrator(): void {
    if (this.policy.isManagement(this.actor) && !this.isAdministrator)
      throw new AgentOperationError("FORBIDDEN", { reason: "role_grant" });
    requireMcpUserRight(this.isAdministrator);
  }

  /**
   * Fingerprints the actor's facts, so a cursor ends when the rights change.
   *
   * @returns A hash of the current account facts.
   */
  public rightsFingerprint(): string {
    return createHash("sha256")
      .update(JSON.stringify(this.actor))
      .digest("hex");
  }

  /**
   * Resolves an account the actor may see in the user management.
   *
   * @param userId - The account.
   * @throws {McpUserError} `not_found` for an unknown or hidden account alike.
   */
  public visibleAccount(userId: string): AccountAccess {
    const account = this.snapshot.accounts.find(
      (candidate) => candidate.userId === userId,
    );
    if (account === undefined || !this.policy.canSee(this.actor, account))
      throw new McpUserError("not_found");
    return account;
  }

  /** Whether the actor sees an account. */
  public canSee(account: AccountAccess): boolean {
    return this.policy.canSee(this.actor, account);
  }

  /** The visible accounts among the given ones. */
  public visibleIds(accounts: readonly AccountAccess[]): readonly string[] {
    return sortedIds(
      accounts
        .filter((account) => this.canSee(account))
        .map((account) => account.userId),
    );
  }

  /** The roles of the role catalog of the interface: assignable or editable ones. */
  public visibleRoles(): readonly UserRole[] {
    return this.snapshot.roles.filter(
      (role) =>
        this.policy.canAssignRole(this.actor, role) || this.canEditRole(role),
    );
  }

  /**
   * Resolves a role of the role catalog.
   *
   * @param roleId - The role.
   * @throws {McpUserError} `not_found` for an unknown role or one outside the catalog.
   */
  public visibleRole(roleId: string): UserRole {
    const role = this.visibleRoles().find(
      (candidate) => candidate.id === roleId,
    );
    if (role === undefined) throw new McpUserError("not_found");
    return role;
  }

  /** The accounts holding a role. */
  public holders(roleId: string): readonly AccountAccess[] {
    return this.snapshot.accounts.filter(
      (account) => account.role?.id === roleId,
    );
  }

  /** Whether the actor may change, or unused delete, a role as it is. */
  public canEditRole(role: UserRole): boolean {
    return this.policy.canEditRole(
      this.actor,
      role,
      role,
      this.holders(role.id),
    );
  }

  /** The departments the user management shows the actor. */
  public visibleDepartments(): readonly Department[] {
    return this.snapshot.departments.filter(
      (department) =>
        this.isAdministrator ||
        this.policy.canManageDepartment(this.actor, department.id) ||
        this.actor.departments.includes(department.id) ||
        this.snapshot.accounts.some(
          (account) =>
            this.canSee(account) && account.departments.includes(department.id),
        ),
    );
  }

  /**
   * Resolves a department the actor sees.
   *
   * @param departmentId - The department.
   * @throws {McpUserError} `not_found` for an unknown or hidden department.
   */
  public visibleDepartment(departmentId: string): Department {
    const department = this.visibleDepartments().find(
      (candidate) => candidate.id === departmentId,
    );
    if (department === undefined) throw new McpUserError("not_found");
    return department;
  }

  /** The accounts that are members of a department. */
  public departmentMembers(departmentId: string): readonly AccountAccess[] {
    return this.snapshot.accounts.filter((account) =>
      account.departments.includes(departmentId),
    );
  }

  /** The groups the actor sees; none without the right to manage groups. */
  public async visibleGroups(): Promise<readonly UserGroup[]> {
    if (!this.policy.canManageGroups(this.actor)) return [];
    const groups = await this.repository.groups().findAll();
    return groups.filter((group) =>
      this.policy.canSeeGroup(this.actor, this.groupMembers(group)),
    );
  }

  /**
   * Resolves a group the actor sees.
   *
   * @param groupId - The group.
   * @throws {McpUserError} `not_found` for an unknown or hidden group.
   */
  public async visibleGroup(groupId: string): Promise<UserGroup> {
    const group = (await this.visibleGroups()).find(
      (candidate) => candidate.id === groupId,
    );
    if (group === undefined) throw new McpUserError("not_found");
    return group;
  }

  /** The accounts listed in a group. */
  public groupMembers(group: UserGroup): readonly AccountAccess[] {
    return this.snapshot.accounts.filter((account) =>
      group.memberIds.includes(account.userId),
    );
  }

  /** Whether the actor may change a group with all its members. */
  public canChangeGroup(group: UserGroup): boolean {
    return this.policy.canChangeGroup(this.actor, this.groupMembers(group));
  }
}
