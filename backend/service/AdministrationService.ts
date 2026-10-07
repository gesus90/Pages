import { createHash, randomUUID } from "node:crypto";

import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { generateTemporaryPassword } from "@/backend/auth/TemporaryPassword";
import { AdministrationError } from "@/backend/error/AdministrationError";
import { EmailTakenError } from "@/backend/error/UserErrors";
import { CAPABILITY } from "@/definition/Authorization";
import { EMAIL_PATTERN } from "@/definition/User";

import {
  activeAccount,
  findAccount,
  requireAdministration,
  validateAdministrationName,
} from "./AdministrationAccess";
import {
  projectProjection,
  updateProjectProjection,
} from "./LegacyProjectAuthorization";
import { RoleAdministrationService } from "./RoleAdministrationService";
import { DepartmentAdministrationService } from "./DepartmentAdministrationService";

import type {
  AuthorizationRepository,
  AuthorizationSnapshot,
} from "@/backend/database/repositories/AuthorizationRepository";
import type {
  AccountAccess,
  AccountMode,
  AccountCreateInput,
  AccountProfileInput,
  Department,
  ManagementScopeInput,
  UserRole,
} from "@/definition/Authorization";
import type { ServerCache } from "@/backend/cache/ServerCache";
import type { PasswordHasher } from "@/backend/auth/PasswordHasher";
import type {
  AdministrationPageData,
  ManagedUser,
} from "@/definition/Authorization";

/** Authorizes aggregate mutations using current facts inside the database transaction. */
export class AdministrationService {
  private readonly policy = new UserPolicyService();
  private readonly repository: AuthorizationRepository;
  private readonly cache: ServerCache;
  private readonly hasher: PasswordHasher;

  /** Creates the management boundary and its compatibility-cache invalidation. */
  public constructor(
    repository: AuthorizationRepository,
    cache: ServerCache,
    hasher: PasswordHasher,
  ) {
    this.repository = repository;
    this.cache = cache;
    this.hasher = hasher;
  }

  /** Returns current account facts for personal settings, never another user's context. */
  public async getContext(userId: string): Promise<AccountAccess> {
    return activeAccount(await this.repository.snapshot(), userId);
  }

  /** Fingerprints current account facts so other devices can revalidate stale UI. */
  public async version(userId: string): Promise<string> {
    return createHash("sha256")
      .update(JSON.stringify(await this.getContext(userId)))
      .digest("hex");
  }

  /** Keeps navigation hints, active mode and fingerprint on one account snapshot. */
  public async navigation(userId: string): Promise<{
    readonly account: AccountAccess;
    readonly version: string;
    readonly canViewUsers: boolean;
  }> {
    const account = await this.getContext(userId);
    return {
      account,
      version: createHash("sha256")
        .update(JSON.stringify(account))
        .digest("hex"),
      canViewUsers: this.policy.canEnter(account),
    };
  }

  /** Whether a signed-in account may enter the administration routes. */
  public async canEnter(userId: string): Promise<boolean> {
    return this.policy.canEnter(await this.getContext(userId));
  }

  /** Reads one consistent administration view, including per-role editing hints. */
  public async pageData(userId: string): Promise<AdministrationPageData> {
    return this.repository.transaction(async (repository) => {
      const scope = new AdministrationService(
        repository,
        this.cache,
        this.hasher,
      );
      const snapshot = await repository.snapshot();
      const actor = activeAccount(snapshot, userId);
      const directory = await scope.directory(userId);
      const manageableDepartmentIds = snapshot.departments
        .filter((department) =>
          this.policy.canManageDepartment(actor, department.id),
        )
        .map((department) => department.id);
      return {
        actor,
        users: await scope.listUsers(userId),
        assignableRoles: directory.roles,
        departments: directory.departments,
        manageableDepartmentIds,
        adoptableDepartmentIds: this.policy.has(
          actor,
          CAPABILITY.MANAGE_DEPARTMENTS,
        )
          ? manageableDepartmentIds
          : actor.departments,
        canCreate: this.policy.has(actor, CAPABILITY.MANAGE_USERS),
        canManageRoles: this.policy.has(actor, CAPABILITY.MANAGE_ROLES),
        canManageDepartments: this.policy.has(
          actor,
          CAPABILITY.MANAGE_DEPARTMENTS,
        ),
        editableRoleIds: snapshot.roles
          .filter((role) =>
            this.policy.canEditRole(
              actor,
              role,
              role,
              snapshot.accounts.filter(
                (account) => account.role?.id === role.id,
              ),
            ),
          )
          .map((role) => role.id),
      };
    });
  }

  /** Returns a filtered snapshot for directory selectors and visible people. */
  public async directory(userId: string): Promise<AuthorizationSnapshot> {
    const snapshot = await this.repository.snapshot();
    const actor = activeAccount(snapshot, userId);
    requireAdministration(this.policy.canEnter(actor));
    const accounts = snapshot.accounts.filter((target) =>
      this.policy.canSee(actor, target),
    );
    return {
      accounts,
      roles: snapshot.roles.filter((role) =>
        this.policy.canAssignRole(actor, role),
      ),
      departments: snapshot.departments.filter(
        (department) =>
          this.policy.isAdministrator(actor) ||
          this.policy.canManageDepartment(actor, department.id) ||
          actor.departments.includes(department.id) ||
          accounts.some((account) =>
            account.departments.includes(department.id),
          ),
      ),
    };
  }

  /** Returns only visible directory identities and addresses. */
  public async listUsers(userId: string): Promise<readonly ManagedUser[]> {
    return this.repository.transaction(async (repository) => {
      const snapshot = await repository.snapshot();
      const actor = activeAccount(snapshot, userId);
      requireAdministration(this.policy.canEnter(actor));
      const visible = new Map(
        snapshot.accounts
          .filter((target) => this.policy.canSee(actor, target))
          .map((target) => [target.userId, target]),
      );
      const users = (await repository.users().findAll()).filter((user) =>
        visible.has(user.id),
      );
      const emails = await repository
        .users()
        .findEmailsByUserIds(users.map((user) => user.id));
      return users.map((user) => {
        const account = findAccount(snapshot, user.id);
        const canEditProfile = this.policy.canChange(
          actor,
          account,
          CAPABILITY.MANAGE_ROLES,
        );
        const canManageAccess = this.policy.canChange(
          actor,
          account,
          CAPABILITY.MANAGE_USERS,
        );
        const canManageMemberships =
          this.policy.canChange(
            actor,
            account,
            CAPABILITY.MANAGE_DEPARTMENTS,
          ) ||
          (canEditProfile && account.departments.length === 0);
        const canManageScope = this.policy.isAdministrator(actor);
        return {
          ...user,
          email: emails.get(user.id) ?? null,
          account,
          canEditProfile,
          canManageAccess,
          canManageMemberships,
          canManageScope,
          canManage:
            canEditProfile ||
            canManageAccess ||
            canManageMemberships ||
            canManageScope,
        };
      });
    });
  }

  /** Creates an account with an unrecoverable temporary password and validated scope. */
  public async createUser(
    userId: string,
    input: AccountCreateInput,
  ): Promise<{ readonly temporaryPassword: string }> {
    this.validateProfile(input);
    validateAdministrationName(input.firstName);
    validateAdministrationName(input.lastName);
    const result = await this.repository.transaction(async (repository) => {
      const snapshot = await repository.snapshot();
      const actor = activeAccount(snapshot, userId);
      requireAdministration(this.policy.has(actor, CAPABILITY.MANAGE_USERS));
      requireAdministration(
        !input.isAdmin || this.policy.isAdministrator(actor),
      );
      const role =
        snapshot.roles.find((candidate) => candidate.id === input.roleId) ??
        null;
      if (
        (input.roleId !== null && role === null) ||
        (!input.isAdmin && role === null)
      ) {
        throw new AdministrationError("invalidInput");
      }
      requireAdministration(
        role === null || this.policy.canAssignRole(actor, role),
      );
      const account: AccountAccess = {
        userId: randomUUID(),
        role,
        isAdmin: input.isAdmin,
        mode: input.isAdmin ? "admin" : "role",
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        isActive: true,
        departments: [],
        managedDepartments: [],
        allDepartments: false,
        allProjects: false,
        hasHadDepartment: false,
      };
      if (input.departments.length > 0) {
        requireAdministration(
          this.policy.canSetMemberships(actor, account, input.departments),
        );
        this.validateDepartments(snapshot, input.departments);
      }
      const temporaryPassword = generateTemporaryPassword();
      if (input.email && (await repository.users().findByEmail(input.email))) {
        throw new EmailTakenError(input.email);
      }
      await repository.users().insert({
        id: account.userId,
        username: input.username.trim(),
        displayName: `${account.firstName} ${account.lastName}`,
        email: input.email,
        passwordHash: await this.hasher.hash(temporaryPassword),
        mustChangePassword: true,
        role: projectProjection(account),
        authorization: {
          roleId: role?.id ?? null,
          isAdmin: input.isAdmin,
          mode: account.mode,
          firstName: account.firstName,
          lastName: account.lastName,
        },
      });
      await repository.saveAccount({
        ...account,
        departments: input.departments,
      });
      return { temporaryPassword };
    });
    this.cache.invalidateUsers();
    return result;
  }

  /** Changes identity fields without giving implicit role or membership permissions. */
  public async updateProfile(
    userId: string,
    targetId: string,
    input: AccountProfileInput,
  ): Promise<void> {
    this.validateProfile(input);
    await this.repository.transaction(async (repository) => {
      const snapshot = await repository.snapshot();
      const actor = activeAccount(snapshot, userId);
      const target = findAccount(snapshot, targetId);
      requireAdministration(
        this.policy.canChange(actor, target, CAPABILITY.MANAGE_ROLES),
      );
      await repository.users().updateProfile(targetId, {
        username: input.username.trim(),
        email: input.email,
        displayName:
          `${input.firstName.trim()} ${input.lastName.trim()}`.trim(),
      });
      await repository.saveAccount({
        ...target,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
      });
    });
    this.cache.invalidateUsers();
  }

  /** Preserves the existing personal display-name editor without changing role or eligibility. */
  public async updateOwnDisplayProfile(
    userId: string,
    profile: {
      readonly displayName: string;
      readonly username: string;
      readonly email: string | null;
    },
  ): Promise<void> {
    this.validateProfile({
      ...profile,
      firstName: profile.displayName,
      lastName: "",
    });
    await this.repository.transaction(async (repository) => {
      const account = activeAccount(await repository.snapshot(), userId);
      requireAdministration(this.policy.isAdministrator(account));
      await repository.users().updateProfile(userId, profile);
      await repository.saveAccount({
        ...account,
        firstName: profile.displayName.trim(),
        lastName: "",
      });
    });
    this.cache.invalidateUsers();
  }

  /** Resets an allowed account and revokes sessions together with its password change. */
  public async resetPassword(
    userId: string,
    targetId: string,
  ): Promise<{ readonly temporaryPassword: string }> {
    return this.repository.transaction(async (repository) => {
      const snapshot = await repository.snapshot();
      requireAdministration(
        this.policy.canChange(
          activeAccount(snapshot, userId),
          findAccount(snapshot, targetId),
          CAPABILITY.MANAGE_USERS,
        ),
      );
      const temporaryPassword = generateTemporaryPassword();
      await repository
        .users()
        .resetPasswordHash(targetId, await this.hasher.hash(temporaryPassword));
      return { temporaryPassword };
    });
  }

  /** Only admin mode may explicitly grant or change personal management scopes. */
  public async setScope(
    userId: string,
    targetId: string,
    scope: ManagementScopeInput,
  ): Promise<void> {
    await this.repository.transaction(async (repository) => {
      const snapshot = await repository.snapshot();
      requireAdministration(
        this.policy.isAdministrator(activeAccount(snapshot, userId)),
      );
      this.validateDepartments(snapshot, scope.managedDepartments);
      await repository.saveAccount({
        ...findAccount(snapshot, targetId),
        ...scope,
      });
    });
    this.cache.invalidateProjectMembership();
  }

  /** Saves a shared role through its delegation boundary. */
  public async saveRole(userId: string, input: UserRole): Promise<void> {
    await new RoleAdministrationService(this.repository, this.cache).saveRole(
      userId,
      input,
    );
  }

  /** Deletes an unassigned role through its delegation boundary. */
  public async deleteRole(userId: string, roleId: string): Promise<void> {
    await new RoleAdministrationService(this.repository, this.cache).deleteRole(
      userId,
      roleId,
    );
  }

  /** Saves a department and assigns new departments to the creator's scope. */
  public async saveDepartment(
    userId: string,
    input: Department,
  ): Promise<void> {
    await new DepartmentAdministrationService(this.repository).saveDepartment(
      userId,
      input,
    );
    this.cache.invalidatePrefix("project:");
    this.cache.invalidateProjectsList();
  }

  /** Deletes a department, permitting its former members to become departmentless. */
  public async deleteDepartment(
    userId: string,
    departmentId: string,
  ): Promise<void> {
    await new DepartmentAdministrationService(this.repository).deleteDepartment(
      userId,
      departmentId,
    );
    this.cache.invalidatePrefix("project:");
    this.cache.invalidateProjectMembership();
    this.cache.invalidateWorkItems();
    this.cache.invalidateLabels();
    this.cache.invalidateGitHub();
  }

  /** Applies a membership change with before-state scope checks. */
  public async setMemberships(
    userId: string,
    targetId: string,
    departments: readonly string[],
  ): Promise<void> {
    await this.repository.transaction(async (repository) => {
      const snapshot = await repository.snapshot();
      const actor = activeAccount(snapshot, userId);
      const target = findAccount(snapshot, targetId);
      requireAdministration(
        this.policy.canSetMemberships(actor, target, departments),
      );
      if (
        departments.some(
          (id) =>
            !snapshot.departments.some((department) => department.id === id),
        )
      ) {
        throw new AdministrationError("invalidInput");
      }
      await repository.saveAccount({ ...target, departments });
    });
    this.cache.invalidateProjectMembership();
  }

  /** Switches the whole account's active mode; a normal role must exist first. */
  public async setMode(userId: string, mode: AccountMode): Promise<void> {
    await this.repository.transaction(async (repository) => {
      const actor = activeAccount(await repository.snapshot(), userId);
      requireAdministration(
        actor.isAdmin && (mode === "admin" || actor.role !== null),
      );
      await repository.saveAccount({ ...actor, mode });
      await updateProjectProjection(repository);
    });
    this.cache.invalidateProjectMembership();
  }

  /** Grants or removes personal admin eligibility without changing the selected role. */
  public async setAdministrator(
    userId: string,
    targetId: string,
    isAdmin: boolean,
  ): Promise<void> {
    await this.repository.transaction(async (repository) => {
      const snapshot = await repository.snapshot();
      requireAdministration(
        this.policy.isAdministrator(activeAccount(snapshot, userId)),
      );
      const target = findAccount(snapshot, targetId);
      if (!isAdmin) {
        this.requireLastAdministrator(snapshot, target);
        if (target.role === null) {
          throw new AdministrationError("invalidInput");
        }
      }
      await repository.saveAccount({
        ...target,
        isAdmin,
        mode: isAdmin ? target.mode : "role",
      });
      await updateProjectProjection(repository);
    });
    this.cache.invalidateProjectMembership();
  }

  /** Assigns a normal role after checking current target, role rank and capabilities. */
  public async assignRole(
    userId: string,
    targetId: string,
    roleId: string,
  ): Promise<void> {
    await this.repository.transaction(async (repository) => {
      const snapshot = await repository.snapshot();
      const actor = activeAccount(snapshot, userId);
      const target = findAccount(snapshot, targetId);
      const role = snapshot.roles.find((candidate) => candidate.id === roleId);
      requireAdministration(
        this.policy.canChange(actor, target, CAPABILITY.MANAGE_ROLES),
      );
      if (!role) {
        throw new AdministrationError("notFound");
      }
      requireAdministration(this.policy.canAssignRole(actor, role));
      await repository.saveAccount({ ...target, role });
      await updateProjectProjection(repository);
    });
    this.cache.invalidateProjectMembership();
  }

  /** Deactivates or reactivates an allowed target, preserving at least one active admin. */
  public async setActive(
    userId: string,
    targetId: string,
    isActive: boolean,
  ): Promise<void> {
    await this.repository.transaction(async (repository) => {
      const snapshot = await repository.snapshot();
      const actor = activeAccount(snapshot, userId);
      const target = findAccount(snapshot, targetId);
      requireAdministration(
        this.policy.canChange(actor, target, CAPABILITY.MANAGE_USERS),
      );
      if (!isActive) {
        this.requireLastAdministrator(snapshot, target);
      }
      await repository.users().setActive(targetId, isActive);
    });
    this.cache.invalidateUsers();
  }

  private requireLastAdministrator(
    snapshot: AuthorizationSnapshot,
    target: AccountAccess,
  ): void {
    if (
      target.isAdmin &&
      target.isActive &&
      snapshot.accounts.filter((account) => account.isAdmin && account.isActive)
        .length <= 1
    ) {
      throw new AdministrationError("lastAdministrator");
    }
  }

  private validateProfile(input: AccountProfileInput): void {
    validateAdministrationName(input.username);
    if (
      (!input.firstName.trim() && !input.lastName.trim()) ||
      input.firstName.length > 200 ||
      input.lastName.length > 200 ||
      (input.email !== null &&
        (input.email.length > 320 || !EMAIL_PATTERN.test(input.email)))
    ) {
      throw new AdministrationError("invalidInput");
    }
  }

  private validateDepartments(
    snapshot: AuthorizationSnapshot,
    ids: readonly string[],
  ): void {
    if (
      ids.some(
        (id) =>
          !snapshot.departments.some((department) => department.id === id),
      )
    ) {
      throw new AdministrationError("invalidInput");
    }
  }
}
