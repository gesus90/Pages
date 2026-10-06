import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { CAPABILITY, isCapability } from "@/definition/Authorization";
import { AdministrationError } from "@/backend/error/AdministrationError";
import {
  activeAccount,
  requireAdministration,
  validateAdministrationName,
  requireUniqueAdministrationName,
} from "./AdministrationAccess";
import { updateProjectProjection } from "./LegacyProjectAuthorization";
import type { ServerCache } from "@/backend/cache/ServerCache";
import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import type { UserRole } from "@/definition/Authorization";

/** Owns role delegation and shared-role mutations. */
export class RoleAdministrationService {
  private readonly policy = new UserPolicyService();
  private readonly repository: AuthorizationRepository;
  private readonly cache: ServerCache;

  /** Binds role operations to the aggregate transaction and project cache. */
  public constructor(repository: AuthorizationRepository, cache: ServerCache) {
    this.repository = repository;
    this.cache = cache;
  }

  /** Creates or edits a shared role; existing holders must all be within scope. */
  public async saveRole(userId: string, input: UserRole): Promise<void> {
    this.validateRole(input);
    await this.repository.transaction(async (repository) => {
      const snapshot = await repository.snapshot();
      const actor = activeAccount(snapshot, userId);
      const current = snapshot.roles.find((role) => role.id === input.id);
      if (current) {
        requireAdministration(
          this.policy.canEditRole(
            actor,
            current,
            input,
            snapshot.accounts.filter(
              (account) => account.role?.id === current.id,
            ),
          ),
        );
      } else {
        requireAdministration(
          this.policy.has(actor, CAPABILITY.MANAGE_ROLES) &&
            this.policy.canAssignRole(actor, input),
        );
      }
      requireUniqueAdministrationName(snapshot.roles, input);
      await repository.saveRole({ ...input, name: input.name.trim() });
      await updateProjectProjection(repository);
    });
    this.cache.invalidateProjectMembership();
  }

  /** Deletes only unassigned roles the actor could otherwise edit. */
  public async deleteRole(userId: string, roleId: string): Promise<void> {
    await this.repository.transaction(async (repository) => {
      const snapshot = await repository.snapshot();
      const actor = activeAccount(snapshot, userId);
      const role = snapshot.roles.find((candidate) => candidate.id === roleId);
      if (!role) {
        throw new AdministrationError("notFound");
      }
      requireAdministration(this.policy.canEditRole(actor, role, role, []));
      if (snapshot.accounts.some((account) => account.role?.id === role.id)) {
        throw new AdministrationError("inUse");
      }
      await repository.deleteRole(roleId);
    });
  }

  private validateRole(role: UserRole): void {
    validateAdministrationName(role.name);
    if (
      !Number.isSafeInteger(role.rank) ||
      role.rank < 0 ||
      role.permissions.some((permission) => !isCapability(permission))
    ) {
      throw new AdministrationError("invalidInput");
    }
  }
}
