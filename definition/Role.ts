/** Roles that can be assigned to Pages users. */
export const ROLE = {
  ADMIN: "admin",
  PROJECT_MANAGER: "project_manager",
  EMPLOYEE: "employee",
} as const;

/** A role recognized by the authorization layer. */
export type Role = (typeof ROLE)[keyof typeof ROLE];

/** Permissions currently understood by the authorization foundation. */
export const PERMISSION = {
  MANAGE_APPLICATION: "manage_application",
  MANAGE_PROJECTS: "manage_projects",
  PARTICIPATE_IN_PROJECTS: "participate_in_projects",
} as const;

/** An operation controlled by role-based authorization. */
export type Permission = (typeof PERMISSION)[keyof typeof PERMISSION];
