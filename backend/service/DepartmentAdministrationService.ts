import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { CAPABILITY } from "@/definition/Authorization";
import {
  activeAccount,
  requireAdministration,
  validateAdministrationName,
  requireUniqueAdministrationName,
} from "./AdministrationAccess";
import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import type { Department } from "@/definition/Authorization";

/** Owns department labels and their membership deletion exception. */
export class DepartmentAdministrationService {
  private readonly policy = new UserPolicyService();
  private readonly repository: AuthorizationRepository;

  /** Binds department operations to the aggregate transaction. */
  public constructor(repository: AuthorizationRepository) {
    this.repository = repository;
  }

  /** Creates or renames a department and assigns a new one to the creator's scope. */
  public async saveDepartment(
    userId: string,
    input: Department,
  ): Promise<void> {
    validateAdministrationName(input.name);
    await this.repository.transaction(async (repository) => {
      const snapshot = await repository.snapshot();
      const actor = activeAccount(snapshot, userId);
      const exists = snapshot.departments.some(
        (department) => department.id === input.id,
      );
      requireAdministration(
        exists
          ? this.policy.canManageDepartment(actor, input.id)
          : this.policy.has(actor, CAPABILITY.MANAGE_DEPARTMENTS),
      );
      requireUniqueAdministrationName(snapshot.departments, input);
      await repository.saveDepartment({ ...input, name: input.name.trim() });
      if (!exists) {
        await repository.saveAccount({
          ...actor,
          managedDepartments: [...actor.managedDepartments, input.id],
        });
      }
    });
  }

  /** Removes an in-scope department, retaining the historical membership invariant. */
  public async deleteDepartment(
    userId: string,
    departmentId: string,
  ): Promise<void> {
    await this.repository.transaction(async (repository) => {
      const snapshot = await repository.snapshot();
      const actor = activeAccount(snapshot, userId);
      requireAdministration(
        this.policy.canManageDepartment(actor, departmentId),
      );
      await repository.deleteDepartment(departmentId);
    });
  }
}
