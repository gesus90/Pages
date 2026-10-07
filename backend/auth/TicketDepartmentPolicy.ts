import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { CAPABILITY } from "@/definition/Authorization";

import type { AccountAccess } from "@/definition/Authorization";

/** Decides which departments an account may assign to a ticket. */
export class TicketDepartmentPolicy {
  private readonly users = new UserPolicyService();

  /**
   * Tests whether the account may put a ticket into the department.
   *
   * @remarks
   * Own departments always qualify, even without a department-bound role.
   * Managers additionally select the departments they administer, and a
   * manager with global scope selects every department. The department need
   * not belong to the ticket's project.
   */
  public canSelect(actor: AccountAccess, departmentId: string): boolean {
    return (
      actor.isActive &&
      (this.users.isAdministrator(actor) ||
        actor.departments.includes(departmentId) ||
        (this.users.has(actor, CAPABILITY.MANAGE_PROJECTS) &&
          (actor.allProjects ||
            actor.allDepartments ||
            actor.managedDepartments.includes(departmentId))))
    );
  }
}
