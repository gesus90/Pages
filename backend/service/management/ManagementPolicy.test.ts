import { describe, expect, it } from "vitest";

import { ADMINISTRATION_ROLE_ID } from "@/definition/Authorization";

import {
  requireManagementRole,
  requireManagementTarget,
} from "./ManagementPolicy";

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

const administrator = accountOf({
  userId: "admin",
  isAdmin: true,
  mode: "admin",
});
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

describe("requireManagementTarget", () => {
  it("lets administrators change anything", () => {
    expect(() =>
      requireManagementTarget(
        administrator,
        accountOf({ isAdmin: true }),
        "admin",
      ),
    ).not.toThrow();
  });

  it("refuses management changes of administrator targets", () => {
    expect(() =>
      requireManagementTarget(management, accountOf({ isAdmin: true })),
    ).toThrow(expect.objectContaining({ details: { reason: "admin_target" } }));
  });

  it("refuses management changes of itself", () => {
    expect(() =>
      requireManagementTarget(management, accountOf({ userId: "manager" })),
    ).toThrow(
      expect.objectContaining({ details: { reason: "self_escalation" } }),
    );
  });

  it("allows an unchanged role and ordinary targets", () => {
    expect(() =>
      requireManagementTarget(management, accountOf(), "role-1"),
    ).not.toThrow();
    expect(() =>
      requireManagementTarget(management, accountOf()),
    ).not.toThrow();
  });

  it("refuses granting or removing protected roles", () => {
    const grant: unknown = expect.objectContaining({
      details: { reason: "role_grant" },
    });
    expect(() =>
      requireManagementTarget(management, accountOf(), ADMINISTRATION_ROLE_ID),
    ).toThrow(grant);
    expect(() =>
      requireManagementTarget(management, accountOf(), "admin"),
    ).toThrow(grant);
    expect(() =>
      requireManagementTarget(
        accountOf({ userId: "plain" }),
        accountOf({
          role: {
            id: ADMINISTRATION_ROLE_ID,
            name: "M",
            rank: 9,
            departmentBound: false,
            permissions: [],
          },
        }),
        "role-2",
      ),
    ).toThrow(grant);
  });

  it("allows ordinary role changes of a target without a role", () => {
    expect(() =>
      requireManagementTarget(
        accountOf({ userId: "plain" }),
        accountOf({ role: null }),
        "role-2",
      ),
    ).not.toThrow();
  });
});

describe("requireManagementRole", () => {
  it("lets administrators grant protected roles", () => {
    expect(() =>
      requireManagementRole(administrator, ADMINISTRATION_ROLE_ID),
    ).not.toThrow();
  });

  it("refuses protected roles for others and allows ordinary roles", () => {
    expect(() => requireManagementRole(management, "admin")).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
    expect(() =>
      requireManagementRole(management, ADMINISTRATION_ROLE_ID),
    ).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
    expect(() => requireManagementRole(management, "role-1")).not.toThrow();
  });
});
