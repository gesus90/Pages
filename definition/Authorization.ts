import type { UserListItem } from "@/definition/User";
import type { GroupPageData } from "@/definition/UserGroup";

/** Configurable capabilities; reading is always enabled within the permitted scope. */
export const CAPABILITY = {
  WRITE: "write",
  MANAGE_PROJECTS: "manage_projects",
  ARCHIVE_PROJECTS: "archive_projects",
  MILESTONES: "milestones",
  MANAGE_USERS: "manage_users",
  MANAGE_DEPARTMENTS: "manage_departments",
  MANAGE_ROLES: "manage_roles",
} as const;

/** A capability that can be granted by a shared role. */
export type Capability = (typeof CAPABILITY)[keyof typeof CAPABILITY];

/** Narrows an external capability without accepting unknown permission names. */
export function isCapability(value: unknown): value is Capability {
  return (
    typeof value === "string" &&
    Object.values(CAPABILITY).some((permission) => permission === value)
  );
}

/** A reusable role; department memberships belong to users instead. */
export interface UserRole {
  readonly id: string;
  readonly name: string;
  readonly rank: number;
  readonly departmentBound: boolean;
  readonly permissions: readonly Capability[];
}

/** An organizational label with stable identity and no action permissions. */
export interface Department {
  readonly id: string;
  readonly name: string;
}

/** The selected mode is persisted on the account, not on individual sessions. */
export type AccountMode = "admin" | "role";

/** Initial account authorization supplied by setup or validated administration. */
export interface AccountInitialization {
  readonly roleId: string | null;
  readonly isAdmin: boolean;
  readonly mode: AccountMode;
  readonly firstName: string;
  readonly lastName: string;
}

/** Administrative profile fields; email is optional, names are required on creation. */
export interface AccountProfileInput {
  readonly username: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string | null;
}

/** Values required to create an account through the A2 management boundary. */
export interface AccountCreateInput extends AccountProfileInput {
  readonly roleId: string | null;
  readonly isAdmin: boolean;
  readonly departments: readonly string[];
}

/** The personal management range is separate from department memberships. */
export interface ManagementScopeInput {
  readonly managedDepartments: readonly string[];
  readonly allDepartments: boolean;
  readonly allProjects: boolean;
}

/** Current persisted authorization facts, loaded before each management operation. */
export interface AccountAccess {
  readonly userId: string;
  readonly role: UserRole | null;
  readonly isAdmin: boolean;
  readonly mode: AccountMode;
  readonly firstName: string;
  readonly lastName: string;
  readonly isActive: boolean;
  readonly departments: readonly string[];
  readonly managedDepartments: readonly string[];
  readonly allDepartments: boolean;
  readonly allProjects: boolean;
  readonly hasHadDepartment: boolean;
}

/** Directory row with per-action hints computed by the same server-side policy. */
export interface ManagedUser extends UserListItem {
  readonly account: AccountAccess;
  readonly canEditProfile: boolean;
  readonly canManageAccess: boolean;
  readonly canManageMemberships: boolean;
  readonly canManageScope: boolean;
}

/** Server-filtered view model for the three management sections. */
export interface AdministrationPageData {
  readonly users: readonly ManagedUser[];
  readonly assignableRoles: readonly UserRole[];
  readonly departments: readonly Department[];
  readonly actor: AccountAccess;
  readonly canCreate: boolean;
  readonly canManageRoles: boolean;
  readonly canManageDepartments: boolean;
  readonly editableRoleIds: readonly string[];
  readonly manageableDepartmentIds: readonly string[];
  readonly adoptableDepartmentIds: readonly string[];
  readonly groups: GroupPageData;
}
