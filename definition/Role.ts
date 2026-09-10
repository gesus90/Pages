/** Roles that can be assigned to Pages users. */
export const ROLE = {
  ADMIN: "admin",
  MANAGER: "manager",
  EMPLOYEE: "employee",
} as const;

/** A role recognized by the authorization layer. */
export type Role = (typeof ROLE)[keyof typeof ROLE];

/**
 * Narrows unknown data to a role.
 *
 * @param value - Value received from an untrusted source.
 * @returns Whether the value is a supported role.
 */
export function isRole(value: unknown): value is Role {
  return (
    typeof value === "string" &&
    (Object.values(ROLE) as readonly string[]).includes(value)
  );
}

/** Permissions currently understood by the authorization foundation. */
export const PERMISSION = {
  MANAGE_APPLICATION: "manage_application",
  MANAGE_PROJECTS: "manage_projects",
  PARTICIPATE_IN_PROJECTS: "participate_in_projects",
  VIEW_USERS: "view_users",
  MANAGE_USERS: "manage_users",
} as const;

/** An operation controlled by role-based authorization. */
export type Permission = (typeof PERMISSION)[keyof typeof PERMISSION];
