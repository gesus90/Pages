import { describe, expect, it } from "vitest";
import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { CAPABILITY } from "@/definition/Authorization";
import { createAccess, createRole } from "../helpers/authorization";

describe("UserPolicyService", () => {
  const policy = new UserPolicyService();
  const actor = createAccess();
  const admin = createAccess({ isAdmin: true, mode: "admin", role: null });
  const target = createAccess({
    userId: "target",
    role: createRole({
      id: "junior",
      rank: 10,
      permissions: [CAPABILITY.WRITE],
    }),
  });

  it("uses active admin mode, never mere eligibility or an inactive account", () => {
    expect(policy.isAdministrator(admin)).toBe(true);
    expect(policy.isAdministrator(createAccess({ isAdmin: true }))).toBe(false);
    expect(policy.isAdministrator({ ...admin, isActive: false })).toBe(false);
    expect(policy.has(admin, CAPABILITY.MANAGE_USERS)).toBe(true);
    expect(
      policy.has({ ...actor, isActive: false }, CAPABILITY.MANAGE_USERS),
    ).toBe(false);
    expect(policy.has({ ...actor, role: null }, CAPABILITY.MANAGE_USERS)).toBe(
      false,
    );
    expect(
      policy.canEnter(createAccess({ role: createRole({ permissions: [] }) })),
    ).toBe(false);
  });

  it("checks explicit managed scopes and the global department grant", () => {
    expect(policy.canManageDepartment(actor, "backend")).toBe(true);
    expect(policy.canManageDepartment(actor, "hr")).toBe(false);
    expect(
      policy.canManageDepartment({ ...actor, allDepartments: true }, "hr"),
    ).toBe(true);
    expect(policy.canManageDepartment(admin, "hr")).toBe(true);
    expect(
      policy.canManageDepartment(
        createAccess({
          allDepartments: true,
          role: createRole({ permissions: [] }),
        }),
        "hr",
      ),
    ).toBe(false);
  });

  it("unions the ranges of granted capabilities and includes departmentless accounts", () => {
    const own = { ...target, departments: ["frontend"] };
    const managed = { ...target, departments: ["backend"] };
    const outside = { ...target, departments: ["hr"] };
    for (const permission of [
      CAPABILITY.MANAGE_USERS,
      CAPABILITY.MANAGE_ROLES,
    ]) {
      const ownOnly = createAccess({
        role: createRole({ permissions: [permission] }),
      });
      expect(policy.canSee(ownOnly, own)).toBe(true);
      expect(policy.canSee(ownOnly, managed)).toBe(false);
    }
    const managedOnly = createAccess({
      departments: ["hr"],
      role: createRole({ permissions: [CAPABILITY.MANAGE_DEPARTMENTS] }),
    });
    expect(policy.canSee(managedOnly, outside)).toBe(false);
    expect(policy.canSee(managedOnly, managed)).toBe(true);
    expect(policy.canSee(actor, own)).toBe(true);
    expect(policy.canSee(actor, managed)).toBe(true);
    expect(policy.canSee(actor, outside)).toBe(false);
    expect(policy.canSee(actor, { ...target, departments: [] })).toBe(true);
    expect(policy.canSee(admin, outside)).toBe(true);
    expect(policy.canSee({ ...actor, isActive: false }, own)).toBe(false);
  });

  it("requires an action right, range, another account and a comparable rank", () => {
    expect(policy.canChange(actor, target, CAPABILITY.MANAGE_USERS)).toBe(true);
    expect(
      policy.canChange(
        actor,
        { ...target, isAdmin: true },
        CAPABILITY.MANAGE_USERS,
      ),
    ).toBe(true);
    expect(policy.canChange(actor, actor, CAPABILITY.MANAGE_USERS)).toBe(false);
    expect(
      policy.canChange(
        actor,
        { ...target, role: null },
        CAPABILITY.MANAGE_USERS,
      ),
    ).toBe(false);
    expect(
      policy.canChange(
        actor,
        { ...target, role: createRole({ rank: 21 }) },
        CAPABILITY.MANAGE_USERS,
      ),
    ).toBe(false);
    expect(
      policy.canChange(
        actor,
        { ...target, departments: ["hr"] },
        CAPABILITY.MANAGE_USERS,
      ),
    ).toBe(false);
    expect(
      policy.canChange(
        { ...actor, role: null },
        target,
        CAPABILITY.MANAGE_USERS,
      ),
    ).toBe(false);
    expect(policy.canChange(admin, admin, CAPABILITY.MANAGE_USERS)).toBe(true);
  });

  it("bounds assignment by rank and every permission", () => {
    expect(
      policy.canAssignRole(
        actor,
        createRole({ id: "junior", rank: 10, permissions: [CAPABILITY.WRITE] }),
      ),
    ).toBe(true);
    expect(policy.canAssignRole(actor, createRole({ rank: 21 }))).toBe(false);
    expect(
      policy.canAssignRole(
        createAccess({ role: createRole({ permissions: [] }) }),
        createRole(),
      ),
    ).toBe(false);
    expect(policy.canAssignRole({ ...actor, role: null }, createRole())).toBe(
      false,
    );
    expect(
      policy.canAssignRole({ ...actor, isActive: false }, createRole()),
    ).toBe(false);
    expect(policy.canAssignRole(admin, createRole({ rank: 100 }))).toBe(true);
  });

  it("protects own roles and holders outside the manager scope", () => {
    const junior = createRole({
      id: "junior",
      rank: 10,
      permissions: [CAPABILITY.WRITE],
    });
    expect(policy.canEditRole(actor, junior, junior, [target])).toBe(true);
    expect(
      policy.canEditRole(actor, junior, junior, [
        { ...target, departments: ["hr"] },
      ]),
    ).toBe(false);
    expect(policy.canEditRole(actor, createRole(), createRole(), [])).toBe(
      false,
    );
    expect(policy.canEditRole(actor, { ...junior, rank: 21 }, junior, [])).toBe(
      false,
    );
    expect(policy.canEditRole(actor, junior, { ...junior, rank: 21 }, [])).toBe(
      false,
    );
    expect(
      policy.canEditRole({ ...actor, role: null }, junior, junior, []),
    ).toBe(false);
    expect(
      policy.canEditRole(admin, junior, junior, [
        { ...target, departments: ["hr"] },
      ]),
    ).toBe(true);
  });

  it("allows adoption, scoped additions and removal into an outside remaining membership", () => {
    const orphan = { ...target, departments: [], hasHadDepartment: false };
    const rolesOnly = createAccess({
      role: createRole({ permissions: [CAPABILITY.MANAGE_ROLES] }),
    });
    expect(policy.canSetMemberships(rolesOnly, orphan, ["frontend"])).toBe(
      true,
    );
    expect(policy.canSetMemberships(rolesOnly, orphan, ["backend"])).toBe(
      false,
    );
    expect(policy.canSetMemberships(actor, orphan, ["backend"])).toBe(true);
    expect(policy.canSetMemberships(actor, orphan, ["hr"])).toBe(false);
    expect(
      policy.canSetMemberships(actor, target, ["frontend", "backend"]),
    ).toBe(true);
    expect(policy.canSetMemberships(actor, target, ["frontend", "hr"])).toBe(
      false,
    );
    expect(
      policy.canSetMemberships(
        actor,
        { ...target, departments: ["frontend", "hr"] },
        ["hr"],
      ),
    ).toBe(true);
    expect(
      policy.canSetMemberships(actor, { ...target, departments: ["hr"] }, [
        "frontend",
        "hr",
      ]),
    ).toBe(false);
    expect(
      policy.canSetMemberships(rolesOnly, target, ["frontend", "backend"]),
    ).toBe(false);
    expect(policy.canSetMemberships(actor, actor, ["backend"])).toBe(false);
    expect(policy.canSetMemberships(admin, orphan, [])).toBe(true);
    expect(policy.canSetMemberships(admin, target, [])).toBe(false);
    expect(policy.canSetMemberships(admin, target, ["hr"])).toBe(true);
  });
});
