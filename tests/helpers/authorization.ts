import { CAPABILITY } from "@/definition/Authorization";
import type { AccountAccess, UserRole } from "@/definition/Authorization";

/** Builds a persisted role fixture, with independent permissions per test. */
export function createRole(overrides: Partial<UserRole> = {}): UserRole {
  return {
    id: "role",
    name: "Manager",
    rank: 20,
    departmentBound: true,
    permissions: Object.values(CAPABILITY),
    ...overrides,
  };
}

/** Builds a role-mode manager in Frontend, managing Frontend and Backend. */
export function createAccess(
  overrides: Partial<AccountAccess> = {},
): AccountAccess {
  return {
    userId: "actor",
    role: createRole(),
    isAdmin: false,
    mode: "role",
    isActive: true,
    firstName: "Name",
    lastName: "",
    departments: ["frontend"],
    managedDepartments: ["frontend", "backend"],
    allDepartments: false,
    allProjects: false,
    hasHadDepartment: true,
    ...overrides,
  };
}
