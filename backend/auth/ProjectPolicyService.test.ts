import { expect, it } from "vitest";

import { ProjectPolicyService } from "./ProjectPolicyService";

import type {
  ProjectDepartmentSelection,
  ProjectManagementContext,
} from "./ProjectPolicyService";
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

const administrator = account({ isAdmin: true, mode: "admin" });
const service = new ProjectPolicyService();

function selection(
  departmentIds: readonly string[],
  hasDepartments = true,
): ProjectDepartmentSelection {
  return { departmentIds, hasDepartments };
}

function project(
  departmentIds: readonly string[],
  isProjectManager = false,
): ProjectManagementContext {
  return { departmentIds, isProjectManager };
}

it("reads a project for an inactive account never", () => {
  expect(
    service.canAccess(account({ isActive: false, departments: ["dept-a"] }), [
      "dept-a",
    ]),
  ).toBe(false);
});

it("reads every project as administrator and across all projects", () => {
  expect(service.canAccess(administrator, ["dept-z"])).toBe(true);
  expect(service.canAccess(account({ allProjects: true }), ["dept-z"])).toBe(
    true,
  );
});

it("reads every project with an unbound role and any project without departments", () => {
  expect(service.canAccess(account({ role: managerRole }), ["dept-z"])).toBe(
    true,
  );
  expect(service.canAccess(account(), [])).toBe(true);
});

it("reads a department-bound project only through a shared own department", () => {
  const member = account({ role: memberRole, departments: ["dept-a"] });

  expect(service.canAccess(member, ["dept-b", "dept-a"])).toBe(true);
  expect(service.canAccess(member, ["dept-b"])).toBe(false);
  expect(service.canAccess(account(), ["dept-b"])).toBe(false);
});

it("selects a department as administrator, across all projects or by managed department", () => {
  expect(service.canSelectDepartment(administrator, "dept-z")).toBe(true);
  expect(
    service.canSelectDepartment(
      account({ role: managerRole, allProjects: true }),
      "dept-z",
    ),
  ).toBe(true);
  expect(
    service.canSelectDepartment(
      account({ role: managerRole, managedDepartments: ["dept-z"] }),
      "dept-z",
    ),
  ).toBe(true);
  expect(
    service.canSelectDepartment(
      account({ role: managerRole, managedDepartments: ["dept-y"] }),
      "dept-z",
    ),
  ).toBe(false);
});

it("refuses department selection without the project management capability", () => {
  expect(
    service.canSelectDepartment(
      account({ role: memberRole, allProjects: true }),
      "dept-z",
    ),
  ).toBe(false);
});

it("creates a project with departments only when every selected department is in scope", () => {
  const manager = account({
    role: managerRole,
    managedDepartments: ["dept-a"],
  });

  expect(service.canCreate(manager, selection(["dept-a"]))).toBe(true);
  expect(service.canCreate(manager, selection(["dept-a", "dept-b"]))).toBe(
    false,
  );
  expect(service.canCreate(administrator, selection([], false))).toBe(true);
});

it("requires at least one department when the project requires departments", () => {
  expect(service.canCreate(administrator, selection([], true))).toBe(false);
  expect(service.canCreate(administrator, selection([], false))).toBe(true);
});

it("denies project creation without the project management capability", () => {
  expect(
    service.canCreate(
      account({ role: memberRole, allProjects: true }),
      selection(["dept-a"]),
    ),
  ).toBe(false);
});

it("edits general information for active administrators and project managers only", () => {
  expect(service.canEditGeneral(administrator, project(["dept-a"]))).toBe(true);
  expect(
    service.canEditGeneral(
      account({ role: memberRole }),
      project(["dept-a"], true),
    ),
  ).toBe(true);
  expect(
    service.canEditGeneral(
      account({ role: memberRole, isActive: false }),
      project(["dept-a"], true),
    ),
  ).toBe(false);
});

it("edits general information of a project in a managed department", () => {
  const manager = account({
    role: managerRole,
    managedDepartments: ["dept-a"],
  });

  expect(service.canEditGeneral(manager, project(["dept-b", "dept-a"]))).toBe(
    true,
  );
  expect(service.canEditGeneral(manager, project(["dept-b"]))).toBe(false);
  expect(service.canEditGeneral(manager, project([]))).toBe(false);
});

it("edits general information of every project with project-wide scope", () => {
  const manager = account({ role: managerRole, allProjects: true });

  expect(service.canEditGeneral(manager, project([]))).toBe(true);
});

it("manages workspaces with the same responsibility as general information", () => {
  const manager = account({
    role: managerRole,
    managedDepartments: ["dept-a"],
  });

  expect(service.canManageWorkspaces(manager, project(["dept-a"]))).toBe(true);
  expect(service.canManageWorkspaces(manager, project(["dept-b"]))).toBe(false);
});

it("changes departments only with complete current responsibility and scoped new selections", () => {
  const manager = account({
    role: managerRole,
    managedDepartments: ["dept-a", "dept-b"],
  });

  expect(
    service.canChangeDepartments(manager, ["dept-a"], selection(["dept-b"])),
  ).toBe(true);
  expect(
    service.canChangeDepartments(
      manager,
      ["dept-a", "dept-c"],
      selection(["dept-b"]),
    ),
  ).toBe(false);
  expect(service.canChangeDepartments(manager, ["dept-a"], selection([]))).toBe(
    false,
  );
  expect(
    service.canChangeDepartments(manager, ["dept-a"], selection(["dept-z"])),
  ).toBe(false);
});

it("manages assignments of projects whose departments are all in scope", () => {
  const manager = account({
    role: managerRole,
    managedDepartments: ["dept-a"],
  });

  expect(service.canManageAssignments(manager, ["dept-a"])).toBe(true);
  expect(service.canManageAssignments(manager, [])).toBe(true);
  expect(service.canManageAssignments(manager, ["dept-a", "dept-b"])).toBe(
    false,
  );
  expect(
    service.canManageAssignments(
      account({ role: memberRole, allProjects: true }),
      ["dept-a"],
    ),
  ).toBe(false);
  expect(
    service.canManageAssignments(
      account({ role: managerRole, allDepartments: true }),
      ["dept-a"],
    ),
  ).toBe(false);
  expect(service.canManageAssignments(administrator, ["dept-a"])).toBe(true);
});

it("deletes permanently only as administrator", () => {
  expect(service.canDelete(administrator)).toBe(true);
  expect(
    service.canDelete(account({ role: managerRole, allProjects: true })),
  ).toBe(false);
  expect(service.canDelete(account({ isAdmin: true, mode: "role" }))).toBe(
    false,
  );
});

it("deletes a concrete project only as administrator within its departments", () => {
  expect(service.canDeleteProject(administrator, ["dept-a"])).toBe(true);
  expect(
    service.canDeleteProject(
      account({ role: managerRole, allProjects: true }),
      ["dept-a"],
    ),
  ).toBe(false);
  expect(
    service.canDeleteProject(
      account({ isAdmin: true, mode: "admin", isActive: false }),
      ["dept-a"],
    ),
  ).toBe(false);
});

it("archives a project under the same rule as deleting it", () => {
  expect(service.canArchive(administrator, ["dept-a"])).toBe(true);
  expect(
    service.canArchive(
      account({ role: managerRole, managedDepartments: ["dept-a"] }),
      ["dept-a"],
    ),
  ).toBe(false);
});
