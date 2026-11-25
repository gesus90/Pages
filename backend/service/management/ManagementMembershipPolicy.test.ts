import { describe, expect, it } from "vitest";

import { ADMINISTRATION_ROLE_ID } from "@/definition/Authorization";

import { requireManagementMembershipChange } from "./ManagementMembershipPolicy";

import type { AccountAccess } from "@/definition/Authorization";

function accountOf(overrides: Partial<AccountAccess> = {}): AccountAccess {
  return {
    userId: "user-1",
    role: {
      id: "role-1",
      name: "Member",
      rank: 1,
      departmentBound: true,
      permissions: [],
    },
    isAdmin: false,
    mode: "role",
    firstName: "A",
    lastName: "B",
    isActive: true,
    departments: [],
    managedDepartments: [],
    allDepartments: false,
    allProjects: false,
    hasHadDepartment: true,
    ...overrides,
  };
}

const management = accountOf({
  userId: "manager",
  role: {
    id: ADMINISTRATION_ROLE_ID,
    name: "Management",
    rank: 5,
    departmentBound: false,
    permissions: [],
  },
});

describe("requireManagementMembershipChange", () => {
  it("ignores actors outside management", () => {
    expect(() =>
      requireManagementMembershipChange(
        accountOf(),
        accountOf({ isAdmin: true }),
      ),
    ).not.toThrow();
  });

  it("ignores administrators", () => {
    const administrator = {
      ...management,
      isAdmin: true,
      mode: "admin" as const,
    };
    expect(() =>
      requireManagementMembershipChange(
        administrator,
        accountOf({ isAdmin: true }),
      ),
    ).not.toThrow();
  });

  it("refuses administrator targets", () => {
    expect(() =>
      requireManagementMembershipChange(
        management,
        accountOf({ isAdmin: true }),
      ),
    ).toThrow(expect.objectContaining({ details: { reason: "admin_target" } }));
  });

  it("refuses changing itself", () => {
    expect(() =>
      requireManagementMembershipChange(
        management,
        accountOf({ userId: "manager" }),
      ),
    ).toThrow(
      expect.objectContaining({ details: { reason: "self_escalation" } }),
    );
  });

  it("allows other accounts", () => {
    expect(() =>
      requireManagementMembershipChange(management, accountOf()),
    ).not.toThrow();
  });
});
