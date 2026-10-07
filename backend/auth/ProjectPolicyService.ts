import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { CAPABILITY } from "@/definition/Authorization";

import type { AccountAccess } from "@/definition/Authorization";

/** A proposed department selection with the live catalog's minimum requirement. */
export interface ProjectDepartmentSelection {
  readonly departmentIds: readonly string[];
  readonly hasDepartments: boolean;
}

/** Persisted project facts used to evaluate shared management responsibility. */
export interface ProjectManagementContext {
  readonly departmentIds: readonly string[];
  readonly isProjectManager: boolean;
}

/** Evaluates project actions from current account and project facts. */
export class ProjectPolicyService {
  private readonly users = new UserPolicyService();

  /** Reading follows current own departments; project membership never widens a bound role. */
  public canAccess(
    actor: AccountAccess,
    departmentIds: readonly string[],
  ): boolean {
    return (
      actor.isActive &&
      (this.users.isAdministrator(actor) ||
        actor.allProjects ||
        (actor.role !== null && !actor.role.departmentBound) ||
        departmentIds.length === 0 ||
        departmentIds.some((id) => actor.departments.includes(id)))
    );
  }

  /** Tests project management scope independently of department administration. */
  public canSelectDepartment(
    actor: AccountAccess,
    departmentId: string,
  ): boolean {
    return (
      this.users.has(actor, CAPABILITY.MANAGE_PROJECTS) &&
      (this.users.isAdministrator(actor) ||
        actor.allProjects ||
        actor.managedDepartments.includes(departmentId))
    );
  }

  /** Requires management capability and scope for every initially selected department. */
  public canCreate(
    actor: AccountAccess,
    selection: ProjectDepartmentSelection,
  ): boolean {
    return (
      this.users.has(actor, CAPABILITY.MANAGE_PROJECTS) &&
      this.hasMinimumSelection(selection) &&
      selection.departmentIds.every((id) => this.canSelectDepartment(actor, id))
    );
  }

  /** Shared project managers and scoped co-owners may edit general project information. */
  public canEditGeneral(
    actor: AccountAccess,
    project: ProjectManagementContext,
  ): boolean {
    if (!actor.isActive) return false;
    return (
      this.users.isAdministrator(actor) ||
      project.isProjectManager ||
      (this.users.has(actor, CAPABILITY.MANAGE_PROJECTS) &&
        (actor.allProjects ||
          project.departmentIds.some((id) =>
            actor.managedDepartments.includes(id),
          )))
    );
  }

  /** Assignment changes require complete current responsibility and scoped new selections. */
  public canChangeDepartments(
    actor: AccountAccess,
    current: readonly string[],
    next: ProjectDepartmentSelection,
  ): boolean {
    return (
      this.canManageAssignments(actor, current) &&
      this.hasMinimumSelection(next) &&
      next.departmentIds.every((id) => this.canSelectDepartment(actor, id))
    );
  }

  /** Evaluates complete responsibility before presenting an assignment editor. */
  public canManageAssignments(
    actor: AccountAccess,
    departmentIds: readonly string[],
  ): boolean {
    return (
      this.users.has(actor, CAPABILITY.MANAGE_PROJECTS) &&
      this.hasCompleteScope(actor, departmentIds)
    );
  }

  /** Archiving requires its own explicit capability and complete project responsibility. */
  public canArchive(
    actor: AccountAccess,
    departmentIds: readonly string[],
  ): boolean {
    return (
      this.users.has(actor, CAPABILITY.ARCHIVE_PROJECTS) &&
      this.hasCompleteScope(actor, departmentIds)
    );
  }

  /** Only the active administrator mode may permanently delete a project. */
  public canDelete(actor: AccountAccess): boolean {
    return this.users.isAdministrator(actor);
  }

  private hasMinimumSelection(selection: ProjectDepartmentSelection): boolean {
    return !selection.hasDepartments || selection.departmentIds.length > 0;
  }

  private hasCompleteScope(
    actor: AccountAccess,
    departmentIds: readonly string[],
  ): boolean {
    return (
      this.users.isAdministrator(actor) ||
      actor.allProjects ||
      departmentIds.every((id) => actor.managedDepartments.includes(id))
    );
  }
}
