import { PERMISSION, ROLE } from "@/definition/Role";

import type { Permission, Role } from "@/definition/Role";

const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  [ROLE.ADMIN]: [
    PERMISSION.MANAGE_APPLICATION,
    PERMISSION.MANAGE_PROJECTS,
    PERMISSION.PARTICIPATE_IN_PROJECTS,
  ],
  [ROLE.PROJECT_MANAGER]: [
    PERMISSION.MANAGE_PROJECTS,
    PERMISSION.PARTICIPATE_IN_PROJECTS,
  ],
  [ROLE.EMPLOYEE]: [PERMISSION.PARTICIPATE_IN_PROJECTS],
};

/** Centralizes role-based permission checks. */
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
}
