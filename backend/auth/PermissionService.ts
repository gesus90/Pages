import { PERMISSION, ROLE } from "@/definition/Role";

import type { Permission, Role } from "@/definition/Role";

const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  [ROLE.ADMIN]: [
    PERMISSION.MANAGE_APPLICATION,
    PERMISSION.MANAGE_PROJECTS,
    PERMISSION.PARTICIPATE_IN_PROJECTS,
    PERMISSION.VIEW_USERS,
    PERMISSION.MANAGE_USERS,
  ],
  [ROLE.MANAGER]: [
    PERMISSION.MANAGE_PROJECTS,
    PERMISSION.PARTICIPATE_IN_PROJECTS,
    PERMISSION.VIEW_USERS,
    PERMISSION.MANAGE_USERS,
  ],
  [ROLE.EMPLOYEE]: [PERMISSION.PARTICIPATE_IN_PROJECTS],
};

/**
 * Roles a manager is allowed to work with when assigning or managing users.
 *
 * @remarks
 * Managers can only ever act on employees. Administrators are unrestricted
 * and therefore never consult this list.
 */
const MANAGER_SCOPE: readonly Role[] = [ROLE.EMPLOYEE];

/** Centralizes role-based permission and role-hierarchy checks. */
export class PermissionService {
  /**
   * Determines whether a role grants an operation.
   *
   * @param role - Role being authorized.
   * @param permission - Operation requiring authorization.
   * @returns Whether the role grants the permission.
   */
  public hasPermission(role: Role, permission: Permission): boolean {
    return ROLE_PERMISSIONS[role].includes(permission);
  }

  /**
   * Determines whether an actor may assign a role to a user.
   *
   * @param actorRole - Role of the user performing the assignment.
   * @param targetRole - Role being assigned.
   * @returns Whether the assignment is allowed.
   *
   * @remarks
   * Administrators may assign any role. Managers may only ever create or
   * keep users as employees, which prevents privilege escalation.
   */
  public canAssignRole(actorRole: Role, targetRole: Role): boolean {
    if (actorRole === ROLE.ADMIN) {
      return true;
    }

    if (actorRole === ROLE.MANAGER) {
      return MANAGER_SCOPE.includes(targetRole);
    }

    return false;
  }

  /**
   * Determines whether an actor may view or edit a user.
   *
   * @param actorRole - Role of the user performing the action.
   * @param targetRole - Current role of the user being acted upon.
   * @returns Whether the action is allowed.
   */
  public canManageUser(actorRole: Role, targetRole: Role): boolean {
    if (actorRole === ROLE.ADMIN) {
      return true;
    }

    if (actorRole === ROLE.MANAGER) {
      return MANAGER_SCOPE.includes(targetRole);
    }

    return false;
  }
}
