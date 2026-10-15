import { CAPABILITY } from "@/definition/Authorization";

import type {
  AccountAccess,
  Capability,
  UserRole,
} from "@/definition/Authorization";

/** Options that deviate from an active, department-bound employee account. */
export interface AccountOptions {
  readonly userId?: string;
  readonly permissions?: readonly Capability[];
  readonly rank?: number;
  readonly roleId?: string;
  readonly hasRole?: boolean;
  readonly departmentBound?: boolean;
  readonly isAdmin?: boolean;
  readonly mode?: AccountAccess["mode"];
  readonly isActive?: boolean;
  readonly departments?: readonly string[];
  readonly managedDepartments?: readonly string[];
  readonly allDepartments?: boolean;
  readonly allProjects?: boolean;
  readonly hasHadDepartment?: boolean;
}

/** Builds a role with the given capabilities. */
export function roleFixture(
  options: Pick<
    AccountOptions,
    "permissions" | "rank" | "roleId" | "departmentBound"
  > = {},
): UserRole {
  return {
    id: options.roleId ?? "role-employee",
    name: options.roleId ?? "Employee",
    rank: options.rank ?? 1,
    departmentBound: options.departmentBound ?? true,
    permissions: options.permissions ?? [CAPABILITY.WRITE],
  };
}

/** Builds persisted authorization facts without touching a database. */
export function accountFixture(options: AccountOptions = {}): AccountAccess {
  return {
    userId: options.userId ?? "user",
    role: options.hasRole === false ? null : roleFixture(options),
    isAdmin: options.isAdmin ?? false,
    mode: options.mode ?? "role",
    firstName: "Synthetic",
    lastName: "Person",
    isActive: options.isActive ?? true,
    departments: options.departments ?? [],
    managedDepartments: options.managedDepartments ?? [],
    allDepartments: options.allDepartments ?? false,
    allProjects: options.allProjects ?? false,
    hasHadDepartment: options.hasHadDepartment ?? false,
  };
}

/** An administrator whose persisted mode is the administrator mode. */
export function administratorFixture(
  options: AccountOptions = {},
): AccountAccess {
  return accountFixture({
    userId: "admin",
    isAdmin: true,
    mode: "admin",
    hasRole: false,
    ...options,
  });
}
