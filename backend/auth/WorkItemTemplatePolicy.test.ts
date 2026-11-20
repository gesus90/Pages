import { expect, it } from "vitest";

import { TEMPLATE_SCOPE } from "@/definition/WorkItemTemplate";

import { WorkItemTemplatePolicy } from "./WorkItemTemplatePolicy";

import type { AccountAccess, UserRole } from "@/definition/Authorization";
import type { TemplateSharing } from "@/definition/WorkItemTemplate";

const managerRole: UserRole = {
  id: "role-manager",
  name: "Manager",
  rank: 2,
  departmentBound: false,
  permissions: ["manage_projects"],
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

function template(
  sharing: Partial<TemplateSharing> = {},
  ownerId = "owner-1",
): TemplateSharing & { readonly ownerId: string } {
  return {
    scope: TEMPLATE_SCOPE.PRIVATE,
    departmentIds: [],
    projectIds: [],
    ownerId,
    ...sharing,
  };
}

const NO_PROJECTS: ReadonlySet<string> = new Set();
const policy = new WorkItemTemplatePolicy();

it("hides every template from an inactive account", () => {
  const inactive = account({ isActive: false, userId: "owner-1" });

  expect(policy.canView(inactive, template(), NO_PROJECTS)).toBe(false);
});

it("shows every template to the administrator mode", () => {
  const administrator = account({ isAdmin: true, mode: "admin" });

  expect(policy.canView(administrator, template(), NO_PROJECTS)).toBe(true);
});

it("shows a private template only to its owner", () => {
  expect(
    policy.canView(account({ userId: "owner-1" }), template(), NO_PROJECTS),
  ).toBe(true);
  expect(policy.canView(account(), template(), NO_PROJECTS)).toBe(false);
});

it("shows a template shared with everyone to any active account", () => {
  const shared = template({ scope: TEMPLATE_SCOPE.ALL });

  expect(policy.canView(account(), shared, NO_PROJECTS)).toBe(true);
});

it("shows a department template when the account belongs to one of its departments", () => {
  const shared = template({
    scope: TEMPLATE_SCOPE.DEPARTMENTS,
    departmentIds: ["dept-a"],
  });

  expect(
    policy.canView(account({ departments: ["dept-a"] }), shared, NO_PROJECTS),
  ).toBe(true);
  expect(
    policy.canView(account({ departments: ["dept-b"] }), shared, NO_PROJECTS),
  ).toBe(false);
});

it("shows a project template when the account may open one of its projects", () => {
  const shared = template({
    scope: TEMPLATE_SCOPE.PROJECTS,
    projectIds: ["project-a"],
  });

  expect(policy.canView(account(), shared, new Set(["project-a"]))).toBe(true);
  expect(policy.canView(account(), shared, new Set(["project-b"]))).toBe(false);
});

it("lets only the owner or an administrator manage a template", () => {
  expect(
    policy.canManage(account({ userId: "owner-1" }), { ownerId: "owner-1" }),
  ).toBe(true);
  expect(policy.canManage(account(), { ownerId: "owner-1" })).toBe(false);
  expect(
    policy.canManage(account({ isAdmin: true, mode: "admin" }), {
      ownerId: "owner-1",
    }),
  ).toBe(true);
  expect(
    policy.canManage(account({ userId: "owner-1", isActive: false }), {
      ownerId: "owner-1",
    }),
  ).toBe(false);
});

it("refuses every sharing change for an inactive account", () => {
  const inactive = account({ isActive: false });

  expect(
    policy.canShare(
      inactive,
      { scope: TEMPLATE_SCOPE.ALL, departmentIds: [], projectIds: [] },
      NO_PROJECTS,
    ),
  ).toBe(false);
});

it("allows private and all-person sharing to any active account", () => {
  expect(
    policy.canShare(
      account(),
      { scope: TEMPLATE_SCOPE.PRIVATE, departmentIds: [], projectIds: [] },
      NO_PROJECTS,
    ),
  ).toBe(true);
  expect(
    policy.canShare(
      account(),
      { scope: TEMPLATE_SCOPE.ALL, departmentIds: [], projectIds: [] },
      NO_PROJECTS,
    ),
  ).toBe(true);
});

it("requires at least one department that the account may select", () => {
  const manager = account({
    role: managerRole,
    managedDepartments: ["dept-a"],
  });
  const sharing = (departmentIds: readonly string[]): TemplateSharing => ({
    scope: TEMPLATE_SCOPE.DEPARTMENTS,
    departmentIds,
    projectIds: [],
  });

  expect(policy.canShare(manager, sharing([]), NO_PROJECTS)).toBe(false);
  expect(policy.canShare(manager, sharing(["dept-a"]), NO_PROJECTS)).toBe(true);
  expect(
    policy.canShare(manager, sharing(["dept-a", "dept-b"]), NO_PROJECTS),
  ).toBe(false);
});

it("requires at least one project that the account may open", () => {
  const sharing = (projectIds: readonly string[]): TemplateSharing => ({
    scope: TEMPLATE_SCOPE.PROJECTS,
    departmentIds: [],
    projectIds,
  });
  const accessible: ReadonlySet<string> = new Set(["project-a"]);

  expect(policy.canShare(account(), sharing([]), accessible)).toBe(false);
  expect(policy.canShare(account(), sharing(["project-a"]), accessible)).toBe(
    true,
  );
  expect(
    policy.canShare(account(), sharing(["project-a", "project-b"]), accessible),
  ).toBe(false);
});
