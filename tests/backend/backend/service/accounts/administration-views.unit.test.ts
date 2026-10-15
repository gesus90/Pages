import { describe, expect, it } from "vitest";

import { organizationWorld } from "./administration-directory";
import { expectRejection } from "./administration-assertions";

import type { ManagedUser } from "@/definition/Authorization";

function ids(entries: ReadonlyArray<{ readonly id: string }>): string[] {
  return entries.map((entry) => entry.id).sort();
}

function userIds(users: readonly ManagedUser[]): string[] {
  return users.map((user) => user.id).sort();
}

describe("account context", () => {
  it("returns the current facts of an active account", async () => {
    const service = organizationWorld().service();

    await expect(service.getContext("hr")).resolves.toMatchObject({
      userId: "hr",
      isActive: true,
    });
  });

  it("refuses an inactive account as forbidden", async () => {
    const world = organizationWorld();
    world.setUserActive("hr", false);

    await expectRejection(world.service().getContext("hr"), "forbidden");
  });

  it("reports an unknown account as not found", async () => {
    await expectRejection(
      organizationWorld().service().getContext("ghost"),
      "notFound",
    );
  });
});

describe("version and navigation", () => {
  it("fingerprints the account facts and changes with them", async () => {
    const world = organizationWorld();
    const service = world.service();

    const before = await service.version("emp-sales");
    const again = await service.version("emp-sales");
    world.store.accounts.set("emp-sales", {
      ...world.account("emp-sales"),
      departments: ["sales", "legal"],
    });
    const after = await service.version("emp-sales");

    expect(before).toMatch(/^[0-9a-f]{64}$/u);
    expect(again).toBe(before);
    expect(after).not.toBe(before);
  });

  it("combines the account, its version and the entry hint", async () => {
    const service = organizationWorld().service();

    const navigation = await service.navigation("hr");

    expect(navigation.account.userId).toBe("hr");
    expect(navigation.canViewUsers).toBe(true);
    expect(navigation.version).toBe(await service.version("hr"));
  });

  it("hides the user area from an account without a management capability", async () => {
    const service = organizationWorld().service();

    await expect(service.navigation("writer")).resolves.toMatchObject({
      canViewUsers: false,
    });
  });
});

describe("canEnter", () => {
  it.each([
    ["an administrator in administrator mode", "admin", true],
    ["a user manager", "hr", true],
    ["a department manager", "lead", true],
    ["an account with write access only", "writer", false],
  ])("answers for %s", async (_, userId, expected) => {
    const service = organizationWorld().service();

    await expect(service.canEnter(userId)).resolves.toBe(expected);
  });

  it("closes the area for an administrator who works in role mode", async () => {
    const world = organizationWorld();
    world.store.accounts.set("admin", {
      ...world.account("admin"),
      mode: "role",
    });

    await expect(world.service().canEnter("admin")).resolves.toBe(false);
  });
});

describe("directory", () => {
  it("shows an administrator everything", async () => {
    const world = organizationWorld();

    const directory = await world.service().directory("admin");

    expect(directory.accounts).toHaveLength(7);
    expect(ids(directory.departments)).toEqual(["legal", "sales"]);
    expect(ids(directory.roles)).toEqual(ids(world.store.roles));
  });

  it("limits a user manager to the own department and departmentless people", async () => {
    const directory = await organizationWorld().service().directory("hr");

    expect(directory.accounts.map((account) => account.userId).sort()).toEqual([
      "admin",
      "emp-sales",
      "hr",
      "lead",
      "loose",
      "writer",
    ]);
    expect(ids(directory.departments)).toEqual(["sales"]);
  });

  it("offers only roles the actor could assign", async () => {
    const directory = await organizationWorld().service().directory("hr");

    // Rank 5 or lower, without the role management capability, and every
    // capability must be one the actor holds itself.
    expect(ids(directory.roles)).toEqual([
      "role-employee",
      "role-legal",
      "role-writer",
    ]);
  });

  it("refuses an account that cannot enter the area", async () => {
    await expectRejection(
      organizationWorld().service().directory("writer"),
      "forbidden",
    );
  });
});

describe("listUsers", () => {
  it("returns the visible people with their addresses", async () => {
    const users = await organizationWorld().service().listUsers("hr");

    expect(userIds(users)).toEqual([
      "admin",
      "emp-sales",
      "hr",
      "lead",
      "loose",
      "writer",
    ]);
    expect(users.find((user) => user.id === "emp-sales")?.email).toBe(
      "sales@example.test",
    );
    expect(users.find((user) => user.id === "loose")?.email).toBeNull();
  });

  it("computes the action hints from the same policy", async () => {
    const users = await organizationWorld().service().listUsers("hr");
    const hints = (id: string): unknown => {
      const user = users.find((entry) => entry.id === id);

      return user
        ? {
            profile: user.canEditProfile,
            access: user.canManageAccess,
            memberships: user.canManageMemberships,
            scope: user.canManageScope,
            manage: user.canManage,
          }
        : null;
    };

    expect(hints("emp-sales")).toEqual({
      profile: true,
      access: true,
      memberships: false,
      scope: false,
      manage: true,
    });
    // A person without department may be placed by the role manager.
    expect(hints("loose")).toMatchObject({ memberships: true });
    // Nobody changes their own role, access or memberships.
    expect(hints("hr")).toEqual({
      profile: false,
      access: false,
      memberships: false,
      scope: false,
      manage: false,
    });
    // The administrator is listed because no department hides it, but cannot be changed.
    expect(hints("admin")).toMatchObject({ profile: false, access: false });
    expect(hints("emp-legal")).toBeNull();
  });

  it("lets an administrator change every scope", async () => {
    const users = await organizationWorld().service().listUsers("admin");

    expect(users).toHaveLength(7);
    expect(users.every((user) => user.canManageScope)).toBe(true);
  });

  it("refuses an account that cannot enter the area", async () => {
    await expectRejection(
      organizationWorld().service().listUsers("writer"),
      "forbidden",
    );
  });
});

describe("pageData", () => {
  it("describes the capabilities of an administrator", async () => {
    const world = organizationWorld();

    const page = await world.service().pageData("admin");

    expect(page).toMatchObject({
      canCreate: true,
      canManageRoles: true,
      canManageDepartments: true,
    });
    expect([...page.manageableDepartmentIds].sort()).toEqual([
      "legal",
      "sales",
    ]);
    expect([...page.adoptableDepartmentIds].sort()).toEqual(["legal", "sales"]);
    expect([...page.editableRoleIds].sort()).toEqual(ids(world.store.roles));
    expect(page.groups.canManage).toBe(true);
  });

  it("limits a department manager to the managed department", async () => {
    const page = await organizationWorld().service().pageData("lead");

    expect(page).toMatchObject({
      canCreate: true,
      canManageRoles: false,
      canManageDepartments: true,
      manageableDepartmentIds: ["sales"],
      adoptableDepartmentIds: ["sales"],
      editableRoleIds: [],
    });
  });

  it("offers a user manager its own departments for adoption only", async () => {
    const page = await organizationWorld().service().pageData("hr");

    expect(page.manageableDepartmentIds).toEqual([]);
    expect(page.adoptableDepartmentIds).toEqual(["sales"]);
    expect(page.canManageRoles).toBe(true);
  });

  it("marks only roles as editable whose holders are all in reach", async () => {
    const page = await organizationWorld().service().pageData("hr");

    // role-employee: holders in sales and without department are visible.
    // role-legal: its holder works in a department the actor cannot see.
    // role-hr: the actor's own role.
    expect(page.editableRoleIds).toContain("role-employee");
    expect(page.editableRoleIds).not.toContain("role-legal");
    expect(page.editableRoleIds).not.toContain("role-hr");
  });

  it("refuses an account that cannot enter the area", async () => {
    await expectRejection(
      organizationWorld().service().pageData("writer"),
      "forbidden",
    );
  });
});
