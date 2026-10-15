import { describe, expect, it } from "vitest";

import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { accountForChannel } from "@/backend/auth/McpActorContext";
import { CAPABILITY } from "@/definition/Authorization";

import {
  accountFixture,
  administratorFixture,
  roleFixture,
} from "./account-fixture";

const policy = new UserPolicyService();

const manager = accountFixture({
  userId: "manager",
  roleId: "role-manager",
  rank: 5,
  permissions: [
    CAPABILITY.WRITE,
    CAPABILITY.MANAGE_USERS,
    CAPABILITY.MANAGE_DEPARTMENTS,
  ],
  departments: ["sales"],
  managedDepartments: ["sales"],
});

describe("administrator mode", () => {
  it("requires an active administrator in administrator mode", () => {
    expect(policy.isAdministrator(administratorFixture())).toBe(true);
    expect(policy.isAdministrator(administratorFixture({ mode: "role" }))).toBe(
      false,
    );
    expect(
      policy.isAdministrator(administratorFixture({ isActive: false })),
    ).toBe(false);
    expect(policy.isAdministrator(accountFixture({ mode: "admin" }))).toBe(
      false,
    );
  });

  it("lets the MCP channel use personal eligibility instead of the UI mode", () => {
    const eligible = administratorFixture({ mode: "role" });

    expect(new UserPolicyService("mcp").isAdministrator(eligible)).toBe(true);
    expect(new UserPolicyService("ui").isAdministrator(eligible)).toBe(false);
    expect(accountForChannel(eligible, "mcp").mode).toBe("admin");
    expect(accountForChannel(eligible, "ui")).toBe(eligible);
    expect(accountForChannel(accountFixture(), "mcp").mode).toBe("role");
  });
});

describe("capabilities", () => {
  it("grants listed capabilities only to active accounts with a role", () => {
    expect(policy.has(manager, CAPABILITY.MANAGE_USERS)).toBe(true);
    expect(policy.has(manager, CAPABILITY.MANAGE_ROLES)).toBe(false);
    expect(
      policy.has(
        accountFixture({ isActive: false, permissions: [CAPABILITY.WRITE] }),
        CAPABILITY.WRITE,
      ),
    ).toBe(false);
    expect(
      policy.has(accountFixture({ hasRole: false }), CAPABILITY.WRITE),
    ).toBe(false);
  });

  it("lets the administrator mode use every capability", () => {
    expect(policy.has(administratorFixture(), CAPABILITY.MANAGE_ROLES)).toBe(
      true,
    );
  });

  it("opens the management area for one of the three management capabilities", () => {
    expect(policy.canEnter(manager)).toBe(true);
    expect(policy.canEnter(accountFixture())).toBe(false);
    expect(
      policy.canEnter(
        accountFixture({ permissions: [CAPABILITY.MANAGE_ROLES] }),
      ),
    ).toBe(true);
  });
});

describe("visibility", () => {
  it("lets the administrator see everyone and a manager only the own scope", () => {
    const sameDepartment = accountFixture({
      userId: "colleague",
      departments: ["sales"],
    });
    const otherDepartment = accountFixture({
      userId: "stranger",
      departments: ["legal"],
    });
    const withoutDepartment = accountFixture({ userId: "loose" });

    expect(policy.canSee(administratorFixture(), otherDepartment)).toBe(true);
    expect(policy.canSee(manager, sameDepartment)).toBe(true);
    expect(policy.canSee(manager, otherDepartment)).toBe(false);
    expect(policy.canSee(manager, withoutDepartment)).toBe(true);
    expect(policy.canSee(accountFixture(), sameDepartment)).toBe(false);
  });

  it("shows a department of another team only for its managed range", () => {
    const outsider = accountFixture({
      userId: "viewer",
      permissions: [CAPABILITY.MANAGE_DEPARTMENTS],
      managedDepartments: ["legal"],
    });

    expect(
      policy.canSee(outsider, accountFixture({ departments: ["legal"] })),
    ).toBe(true);
    expect(
      policy.canSee(outsider, accountFixture({ departments: ["sales"] })),
    ).toBe(false);
  });
});

describe("changing another account", () => {
  const employee = accountFixture({
    userId: "employee",
    rank: 1,
    departments: ["sales"],
  });

  it("allows a higher or equal rank inside the visible scope", () => {
    expect(policy.canChange(manager, employee, CAPABILITY.MANAGE_USERS)).toBe(
      true,
    );
  });

  it("refuses the own account and a higher ranked target", () => {
    const boss = accountFixture({
      userId: "boss",
      rank: 9,
      departments: ["sales"],
    });

    expect(policy.canChange(manager, manager, CAPABILITY.MANAGE_USERS)).toBe(
      false,
    );
    expect(policy.canChange(manager, boss, CAPABILITY.MANAGE_USERS)).toBe(
      false,
    );
  });

  it("refuses a capability the actor lacks and a target outside the scope", () => {
    const stranger = accountFixture({
      userId: "stranger",
      departments: ["legal"],
    });

    expect(policy.canChange(manager, employee, CAPABILITY.MANAGE_ROLES)).toBe(
      false,
    );
    expect(policy.canChange(manager, stranger, CAPABILITY.MANAGE_USERS)).toBe(
      false,
    );
  });

  it("lets the administrator change even the own account", () => {
    const administrator = administratorFixture();

    expect(
      policy.canChange(administrator, administrator, CAPABILITY.MANAGE_USERS),
    ).toBe(true);
  });
});

describe("assigning and editing roles", () => {
  const lowerRole = roleFixture({
    roleId: "lower",
    rank: 2,
    permissions: [CAPABILITY.WRITE],
  });

  it("does not grant a higher rank, role management or unowned capabilities", () => {
    expect(policy.canAssignRole(manager, lowerRole)).toBe(true);
    expect(
      policy.canAssignRole(manager, roleFixture({ rank: 6, permissions: [] })),
    ).toBe(false);
    expect(
      policy.canAssignRole(
        manager,
        roleFixture({ rank: 1, permissions: [CAPABILITY.MANAGE_ROLES] }),
      ),
    ).toBe(false);
    expect(
      policy.canAssignRole(
        manager,
        roleFixture({ rank: 1, permissions: [CAPABILITY.MANAGE_PROJECTS] }),
      ),
    ).toBe(false);
    expect(
      policy.canAssignRole(accountFixture({ hasRole: false }), lowerRole),
    ).toBe(false);
  });

  it("lets the administrator assign and edit any role", () => {
    const administrator = administratorFixture();
    const role = roleFixture({ rank: 99 });

    expect(policy.canAssignRole(administrator, role)).toBe(true);
    expect(policy.canEditRole(administrator, role, role, [])).toBe(true);
  });

  it("edits a shared role only when every holder is within reach", () => {
    const roleManager = accountFixture({
      userId: "role-manager",
      roleId: "own-role",
      rank: 5,
      permissions: [CAPABILITY.MANAGE_ROLES, CAPABILITY.WRITE],
      departments: ["sales"],
    });
    const current = roleFixture({ roleId: "edited", rank: 2 });
    const inScope = accountFixture({
      userId: "holder",
      departments: ["sales"],
    });
    const outOfScope = accountFixture({
      userId: "far",
      departments: ["legal"],
    });

    expect(policy.canEditRole(roleManager, current, current, [inScope])).toBe(
      true,
    );
    expect(
      policy.canEditRole(roleManager, current, current, [inScope, outOfScope]),
    ).toBe(false);
  });

  it("refuses editing the own role or a role of higher rank", () => {
    const roleManager = accountFixture({
      userId: "role-manager",
      roleId: "own-role",
      rank: 5,
      permissions: [CAPABILITY.MANAGE_ROLES],
    });
    const ownRole = roleFixture({ roleId: "own-role", rank: 5 });
    const higher = roleFixture({ roleId: "higher", rank: 8 });

    expect(policy.canEditRole(roleManager, ownRole, ownRole, [])).toBe(false);
    expect(policy.canEditRole(roleManager, higher, higher, [])).toBe(false);
  });
});

describe("department memberships", () => {
  const target = accountFixture({
    userId: "target",
    rank: 1,
    departments: ["sales"],
    hasHadDepartment: true,
  });

  it("never removes the last department of an account that had one", () => {
    expect(policy.canSetMemberships(administratorFixture(), target, [])).toBe(
      false,
    );
  });

  it("accepts any change by the administrator", () => {
    expect(
      policy.canSetMemberships(administratorFixture(), target, ["legal"]),
    ).toBe(true);
  });

  it("limits a department manager to the managed departments", () => {
    expect(policy.canSetMemberships(manager, target, ["sales"])).toBe(true);
    expect(policy.canSetMemberships(manager, target, ["sales", "legal"])).toBe(
      false,
    );
    expect(policy.canSetMemberships(manager, target, ["legal"])).toBe(false);
  });

  it("limits first assignments to managed departments or own memberships", () => {
    const loose = accountFixture({ userId: "loose" });
    const roleManager = accountFixture({
      userId: "role-manager",
      rank: 5,
      permissions: [CAPABILITY.MANAGE_ROLES],
      departments: ["sales"],
    });

    expect(policy.canSetMemberships(manager, loose, ["sales"])).toBe(true);
    expect(policy.canSetMemberships(manager, loose, ["legal"])).toBe(false);
    expect(policy.canSetMemberships(roleManager, loose, ["sales"])).toBe(true);
    expect(policy.canSetMemberships(roleManager, loose, ["legal"])).toBe(false);
  });
});

describe("departments and groups", () => {
  it("manages a department by capability and range", () => {
    expect(policy.canManageDepartment(manager, "sales")).toBe(true);
    expect(policy.canManageDepartment(manager, "legal")).toBe(false);
    expect(
      policy.canManageDepartment(
        accountFixture({
          permissions: [CAPABILITY.MANAGE_DEPARTMENTS],
          allDepartments: true,
        }),
        "legal",
      ),
    ).toBe(true);
    expect(policy.canManageDepartment(accountFixture(), "sales")).toBe(false);
  });

  it("lists groups of accounts within reach and empty groups", () => {
    const inScope = accountFixture({ userId: "a", departments: ["sales"] });
    const outOfScope = accountFixture({ userId: "b", departments: ["legal"] });

    expect(policy.canSeeGroup(manager, [])).toBe(true);
    expect(policy.canSeeGroup(manager, [outOfScope, inScope])).toBe(true);
    expect(policy.canSeeGroup(manager, [outOfScope])).toBe(false);
    expect(policy.canSeeGroup(administratorFixture(), [outOfScope])).toBe(true);
    expect(policy.canSeeGroup(accountFixture(), [])).toBe(false);
  });

  it("changes a group only when every involved member is within reach", () => {
    const inScope = accountFixture({ userId: "a", departments: ["sales"] });
    const outOfScope = accountFixture({ userId: "b", departments: ["legal"] });

    expect(policy.canChangeGroup(manager, [inScope])).toBe(true);
    expect(policy.canChangeGroup(manager, [inScope, outOfScope])).toBe(false);
    expect(
      policy.canChangeGroup(administratorFixture(), [inScope, outOfScope]),
    ).toBe(true);
    expect(policy.canChangeGroup(accountFixture(), [])).toBe(false);
    expect(policy.canManageGroups(manager)).toBe(true);
  });
});
