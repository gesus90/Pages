import { expect, it } from "vitest";

import { TicketDepartmentPolicy } from "./TicketDepartmentPolicy";

import type { AccountAccess, UserRole } from "@/definition/Authorization";

const managerRole: UserRole = {
  id: "role-manager",
  name: "Manager",
  rank: 2,
  departmentBound: false,
  permissions: ["manage_projects"],
};

const memberRole: UserRole = {
  id: "role-member",
  name: "Member",
  rank: 1,
  departmentBound: true,
  permissions: [],
};

function account(overrides: Partial<AccountAccess> = {}): AccountAccess {
  return {
    userId: "user-1",
    role: null,
    isAdmin: false,
    mode: "role",
    firstName: "Ada",
    lastName: "Lovelace",
    isActive: true,
    departments: [],
    managedDepartments: [],
    allDepartments: false,
    allProjects: false,
    hasHadDepartment: false,
    ...overrides,
  };
}

const policy = new TicketDepartmentPolicy();

it("never allows a department for an inactive account", () => {
  const inactive = account({ departments: ["dept-a"], isActive: false });

  expect(policy.canSelect(inactive, "dept-a")).toBe(false);
});

it("allows any department to an administrator in admin mode", () => {
  const administrator = account({ isAdmin: true, mode: "admin" });

  expect(policy.canSelect(administrator, "dept-z")).toBe(true);
});

it("allows the departments the account belongs to without a manager role", () => {
  const member = account({ role: memberRole, departments: ["dept-a"] });

  expect(policy.canSelect(member, "dept-a")).toBe(true);
  expect(policy.canSelect(member, "dept-b")).toBe(false);
});

it("allows any department to the business administration role", () => {
  const administrationRole: UserRole = {
    ...memberRole,
    id: "role-administration",
  };
  const management = account({ role: administrationRole });

  expect(policy.canSelect(management, "dept-b")).toBe(true);
});

it("lets a manager with project-wide scope select any department", () => {
  const manager = account({ role: managerRole, allProjects: true });

  expect(policy.canSelect(manager, "dept-b")).toBe(true);
});

it("lets a manager with all-department scope select any department", () => {
  const manager = account({ role: managerRole, allDepartments: true });

  expect(policy.canSelect(manager, "dept-b")).toBe(true);
});

it("lets a manager select only the departments it administers", () => {
  const manager = account({
    role: managerRole,
    managedDepartments: ["dept-b"],
  });

  expect(policy.canSelect(manager, "dept-b")).toBe(true);
  expect(policy.canSelect(manager, "dept-c")).toBe(false);
});

it("denies managed departments to a role without the project management capability", () => {
  const withoutCapability = account({
    role: memberRole,
    allDepartments: true,
    managedDepartments: ["dept-b"],
  });

  expect(policy.canSelect(withoutCapability, "dept-b")).toBe(false);
});
