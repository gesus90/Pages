import { isRole } from "@/definition/Role";
import { createUser } from "./factories";
import { createAccess, createRole } from "./authorization";
import type {
  AdministrationPageData,
  ManagedUser,
  UserRole,
} from "@/definition/Authorization";
import type { User } from "@/definition/User";

/** Builds configurable roles with the historic labels used in component fixtures. */
export function directoryRoles(
  ids: readonly string[] = ["admin", "manager", "employee"],
): UserRole[] {
  const labels: Record<string, string> = {
    admin: "Administrator",
    manager: "Manager",
    employee: "Angestellter",
  };
  return ids.map((id) => createRole({ id, name: labels[id] ?? id }));
}

/** Builds explicit per-action hints rather than inferring them in the UI. */
export function managedUser(
  input: Omit<Partial<User>, "role"> & {
    role?: string;
    canManage?: boolean;
    email?: string | null;
  } = {},
): ManagedUser {
  const user = createUser({
    ...input,
    role: isRole(input.role) ? input.role : "employee",
  });
  const canManage = input.canManage ?? true;
  return {
    ...user,
    canManage,
    email: input.email ?? null,
    account: createAccess({
      userId: user.id,
      firstName: user.displayName,
      role: directoryRoles([user.role])[0] ?? null,
    }),
    canEditProfile: canManage,
    canManageAccess: canManage,
    canManageMemberships: canManage,
    canManageScope: canManage,
  };
}

/** Produces the complete loader contract for directory rendering tests. */
export function administrationPage(
  users: readonly ManagedUser[],
  roles: readonly UserRole[] = directoryRoles(),
): AdministrationPageData {
  return {
    users,
    assignableRoles: roles,
    departments: [],
    actor: createAccess({
      userId: "viewer",
      isAdmin: true,
      mode: "admin",
      role: null,
    }),
    canCreate: true,
    canManageRoles: true,
    canManageDepartments: true,
    editableRoleIds: roles.map((role) => role.id),
    manageableDepartmentIds: [],
    adoptableDepartmentIds: [],
    groups: { canManage: true, groups: [] },
  };
}
