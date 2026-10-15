import { describe, expect, it } from "vitest";

import { ProjectPolicyService } from "@/backend/auth/ProjectPolicyService";
import { CAPABILITY } from "@/definition/Authorization";

import { accountFixture, administratorFixture } from "./account-fixture";

const policy = new ProjectPolicyService();

const projectManager = accountFixture({
  userId: "pm",
  permissions: [CAPABILITY.WRITE, CAPABILITY.MANAGE_PROJECTS],
  departments: ["sales"],
  managedDepartments: ["sales"],
});

describe("reading a project", () => {
  it("opens projects of the own departments and of no department", () => {
    const employee = accountFixture({ departments: ["sales"] });

    expect(policy.canAccess(employee, ["sales", "legal"])).toBe(true);
    expect(policy.canAccess(employee, [])).toBe(true);
    expect(policy.canAccess(employee, ["legal"])).toBe(false);
  });

  it("opens every project to an unbound role, all-project scope and the administrator", () => {
    expect(
      policy.canAccess(accountFixture({ departmentBound: false }), ["legal"]),
    ).toBe(true);
    expect(
      policy.canAccess(accountFixture({ allProjects: true }), ["legal"]),
    ).toBe(true);
    expect(policy.canAccess(administratorFixture(), ["legal"])).toBe(true);
  });

  it("opens nothing to an inactive account", () => {
    expect(
      policy.canAccess(administratorFixture({ isActive: false }), []),
    ).toBe(false);
    expect(policy.canAccess(accountFixture({ isActive: false }), [])).toBe(
      false,
    );
  });
});

describe("creating a project", () => {
  it("needs the management capability and a scope for every department", () => {
    const selection = { departmentIds: ["sales"], hasDepartments: true };

    expect(policy.canCreate(projectManager, selection)).toBe(true);
    expect(
      policy.canCreate(projectManager, {
        departmentIds: ["sales", "legal"],
        hasDepartments: true,
      }),
    ).toBe(false);
    expect(policy.canCreate(accountFixture(), selection)).toBe(false);
  });

  it("requires a department when the catalog has any", () => {
    expect(
      policy.canCreate(projectManager, {
        departmentIds: [],
        hasDepartments: true,
      }),
    ).toBe(false);
    expect(
      policy.canCreate(projectManager, {
        departmentIds: [],
        hasDepartments: false,
      }),
    ).toBe(true);
  });

  it("selects any department with the all-project scope or as administrator", () => {
    expect(
      policy.canSelectDepartment(
        accountFixture({
          permissions: [CAPABILITY.MANAGE_PROJECTS],
          allProjects: true,
        }),
        "legal",
      ),
    ).toBe(true);
    expect(policy.canSelectDepartment(administratorFixture(), "legal")).toBe(
      true,
    );
    expect(policy.canSelectDepartment(projectManager, "legal")).toBe(false);
  });
});

describe("editing a project", () => {
  it("allows the shared project manager regardless of capabilities", () => {
    expect(
      policy.canEditGeneral(accountFixture(), {
        departmentIds: ["legal"],
        isProjectManager: true,
      }),
    ).toBe(true);
  });

  it("allows scoped managers and refuses employees and inactive accounts", () => {
    const project = { departmentIds: ["sales"], isProjectManager: false };

    expect(policy.canEditGeneral(projectManager, project)).toBe(true);
    expect(
      policy.canEditGeneral(projectManager, {
        departmentIds: ["legal"],
        isProjectManager: false,
      }),
    ).toBe(false);
    expect(policy.canEditGeneral(accountFixture(), project)).toBe(false);
    expect(
      policy.canEditGeneral(administratorFixture({ isActive: false }), {
        departmentIds: [],
        isProjectManager: true,
      }),
    ).toBe(false);
  });

  it("uses the same responsibility for workspaces", () => {
    const project = { departmentIds: ["sales"], isProjectManager: false };

    expect(policy.canManageWorkspaces(projectManager, project)).toBe(true);
    expect(policy.canManageWorkspaces(accountFixture(), project)).toBe(false);
  });
});

describe("assignments, archiving and deletion", () => {
  it("changes departments only with complete current and scoped new responsibility", () => {
    const next = { departmentIds: ["sales"], hasDepartments: true };

    expect(policy.canChangeDepartments(projectManager, ["sales"], next)).toBe(
      true,
    );
    expect(
      policy.canChangeDepartments(projectManager, ["sales", "legal"], next),
    ).toBe(false);
    expect(
      policy.canChangeDepartments(projectManager, ["sales"], {
        departmentIds: ["legal"],
        hasDepartments: true,
      }),
    ).toBe(false);
    expect(policy.canManageAssignments(projectManager, ["sales"])).toBe(true);
  });

  it("archives with the archive capability and complete responsibility", () => {
    const archivist = accountFixture({
      permissions: [CAPABILITY.ARCHIVE_PROJECTS],
      managedDepartments: ["sales"],
    });

    expect(policy.canArchive(archivist, ["sales"])).toBe(true);
    expect(policy.canArchive(archivist, ["legal"])).toBe(false);
    expect(policy.canArchive(projectManager, ["sales"])).toBe(false);
  });

  it("deletes only as administrator and never through a project role", () => {
    const widest = accountFixture({
      permissions: Object.values(CAPABILITY),
      allProjects: true,
      departmentBound: false,
    });

    expect(policy.canDelete(administratorFixture())).toBe(true);
    expect(policy.canDelete(widest)).toBe(false);
    expect(policy.canDeleteProject(administratorFixture(), ["legal"])).toBe(
      true,
    );
    expect(policy.canDeleteProject(widest, ["legal"])).toBe(false);
    expect(
      policy.canDeleteProject(administratorFixture({ isActive: false }), []),
    ).toBe(false);
  });
});
