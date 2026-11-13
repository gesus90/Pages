import { randomUUID } from "node:crypto";

import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { generateTemporaryPassword } from "@/backend/auth/TemporaryPassword";
import { AdministrationError } from "@/backend/error/AdministrationError";
import { EmailTakenError } from "@/backend/error/UserErrors";
import { CAPABILITY } from "@/definition/Authorization";
import {
  activeAccount,
  requireAdministration,
  requireKnownDepartments,
} from "./AdministrationAccess";
import { projectProjection } from "./LegacyProjectAuthorization";

import type { AccountInvitationDelivery } from "@/definition/Management";
import type {
  AuthorizationRepository,
  AuthorizationSnapshot,
} from "@/backend/database/repositories/AuthorizationRepository";
import type {
  AccountAccess,
  AccountCreateInput,
  UserRole,
} from "@/definition/Authorization";
import type { ServerCache } from "@/backend/cache/ServerCache";
import type { PasswordHasher } from "@/backend/auth/PasswordHasher";
import type { ActorChannel } from "@/backend/auth/McpActorContext";

/** Builds the new account facts before any write, so the checks run on the values stored. */
function newAccount(
  input: AccountCreateInput,
  role: UserRole | null,
): AccountAccess {
  return {
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
}

/** Owns account creation: actor rights, role and scope checks, and the temporary password. */
export class UserCreationService {
  private readonly policy: UserPolicyService;
  private readonly repository: AuthorizationRepository;
  private readonly cache: ServerCache;
  private readonly hasher: PasswordHasher;

  /** Binds account creation to the administration aggregate and its cache. */
  public constructor(
    repository: AuthorizationRepository,
    cache: ServerCache,
    hasher: PasswordHasher,
    channel: ActorChannel,
  ) {
    this.repository = repository;
    this.cache = cache;
    this.hasher = hasher;
    this.policy = new UserPolicyService(channel);
  }

  /** Creates an account; without a delivery channel the temporary password is returned to the caller. */
  public async create(
    userId: string,
    input: AccountCreateInput,
    delivery?: AccountInvitationDelivery,
  ): Promise<{ readonly temporaryPassword: string }> {
    const result = await this.repository.transaction((repository) =>
      this.createInTransaction(repository, userId, input, delivery),
    );
    this.cache.invalidateUsers();
    return result;
  }

  private async createInTransaction(
    repository: AuthorizationRepository,
    userId: string,
    input: AccountCreateInput,
    delivery: AccountInvitationDelivery | undefined,
  ): Promise<{ readonly temporaryPassword: string }> {
    const snapshot = await repository.snapshot();
    const actor = activeAccount(snapshot, userId);
    this.requireCreationRights(actor, input, delivery);
    const role = this.creationRole(snapshot, actor, input);
    const account = newAccount(input, role);
    if (input.departments.length > 0) {
      requireAdministration(
        this.policy.canSetMemberships(actor, account, input.departments),
      );
      requireKnownDepartments(snapshot, input.departments);
    }
    const temporaryPassword = generateTemporaryPassword();
    await this.requireFreeEmail(repository, input.email);
    await this.persist(repository, account, input, temporaryPassword);
    if (delivery) {
      if (!input.email) throw new AdministrationError("invalidInput");
      await delivery.send({
        email: input.email,
        username: input.username,
        temporaryPassword,
      });
    }
    return { temporaryPassword: delivery ? "" : temporaryPassword };
  }

  private requireCreationRights(
    actor: AccountAccess,
    input: AccountCreateInput,
    delivery: AccountInvitationDelivery | undefined,
  ): void {
    requireAdministration(this.policy.has(actor, CAPABILITY.MANAGE_USERS));
    if (this.policy.isManagement(actor) && !delivery)
      throw new AgentOperationError("FORBIDDEN", { reason: "core_system" });
    requireAdministration(!input.isAdmin || this.policy.isAdministrator(actor));
  }

  /** Resolves the requested role and checks that the actor may assign it. */
  private creationRole(
    snapshot: AuthorizationSnapshot,
    actor: AccountAccess,
    input: AccountCreateInput,
  ): UserRole | null {
    const role =
      snapshot.roles.find((candidate) => candidate.id === input.roleId) ?? null;
    if (
      (input.roleId !== null && role === null) ||
      (!input.isAdmin && role === null)
    ) {
      throw new AdministrationError("invalidInput");
    }
    requireAdministration(
      role === null || this.policy.canAssignRole(actor, role),
    );
    return role;
  }

  private async requireFreeEmail(
    repository: AuthorizationRepository,
    email: string | null,
  ): Promise<void> {
    if (email && (await repository.users().findByEmail(email)))
      throw new EmailTakenError(email);
  }

  private async persist(
    repository: AuthorizationRepository,
    account: AccountAccess,
    input: AccountCreateInput,
    temporaryPassword: string,
  ): Promise<void> {
    await repository.users().insert({
      id: account.userId,
      username: input.username.trim(),
      displayName: `${account.firstName} ${account.lastName}`,
      email: input.email,
      passwordHash: await this.hasher.hash(temporaryPassword),
      mustChangePassword: true,
      role: projectProjection(account),
      authorization: {
        roleId: account.role?.id ?? null,
        isAdmin: account.isAdmin,
        mode: account.mode,
        firstName: account.firstName,
        lastName: account.lastName,
      },
    });
    await repository.saveAccount({
      ...account,
      departments: input.departments,
    });
  }
}
