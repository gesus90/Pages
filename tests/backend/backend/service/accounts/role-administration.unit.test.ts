import { describe, expect, it } from "vitest";

import { RoleAdministrationService } from "@/backend/service/RoleAdministrationService";
import { CAPABILITY } from "@/definition/Authorization";

import { expectRejection } from "./administration-assertions";
import { AuthorizationWorld } from "./authorization-world";

import type { UserRole } from "@/definition/Authorization";

const NEW_ROLE: UserRole = {
  id: "role-new",
  name: "  Team lead ",
  rank: 3,
  departmentBound: true,
  permissions: [CAPABILITY.WRITE, CAPABILITY.MANAGE_PROJECTS],
};

interface RoleSetup {
  readonly world: AuthorizationWorld;
  readonly service: RoleAdministrationService;
}

function setup(): RoleSetup {
  const world = new AuthorizationWorld();

  return {
    world,
    service: new RoleAdministrationService(world.repository, world.cache),
  };
}

/** A delegated role editor: rank 5, may edit roles within its own capabilities. */
function addEditor(world: AuthorizationWorld): void {
  world.addAccount({
    userId: "editor",
    roleId: "role-editor",
    rank: 5,
    permissions: [
      CAPABILITY.WRITE,
      CAPABILITY.MANAGE_PROJECTS,
      CAPABILITY.MANAGE_ROLES,
    ],
    departments: ["sales"],
  });
}

describe("saveRole by an administrator", () => {
  it("stores a trimmed role, refreshes the project roles and the cache", async () => {
    const { world, service } = setup();
    world.addAdministrator();

    await service.saveRole("admin", NEW_ROLE);

    expect(world.store.roles).toContainEqual({
      ...NEW_ROLE,
      name: "Team lead",
    });
    expect(world.invalidations).toEqual(["invalidateProjectMembership"]);
  });

  it("projects a changed role onto the legacy role of its holders", async () => {
    const { world, service } = setup();
    world.addAdministrator();
    const staff = world.addRole({
      roleId: "role-staff",
      permissions: [CAPABILITY.WRITE],
    });
    world.addAccount({ userId: "bob", roleId: "role-staff" });
    expect(world.user("bob").role).toBe("employee");

    await service.saveRole("admin", {
      ...staff,
      permissions: [CAPABILITY.WRITE, CAPABILITY.MANAGE_PROJECTS],
    });

    expect(world.user("bob").role).toBe("manager");
    expect(world.user("admin").role).toBe("admin");
  });

  it("lets a role keep its own name when it is renamed in case only", async () => {
    const { world, service } = setup();
    world.addAdministrator();
    const staff = world.addRole({ roleId: "Staff" });

    await service.saveRole("admin", { ...staff, name: "STAFF" });

    expect(world.store.roles.find((role) => role.id === "Staff")?.name).toBe(
      "STAFF",
    );
  });

  it("refuses the name of another role regardless of case", async () => {
    const { world, service } = setup();
    world.addAdministrator();
    world.addRole({ roleId: "Staff" });

    await expectRejection(
      service.saveRole("admin", { ...NEW_ROLE, name: " staff " }),
      "invalidInput",
    );
    expect(world.writes).toEqual([]);
  });
});

describe("saveRole validation", () => {
  // A client can send any string; the type system cannot express that.
  const unvalidated: unknown = ["fly"];
  const forgedCapability = unvalidated as UserRole["permissions"];
  const invalidRoles: ReadonlyArray<readonly [string, Partial<UserRole>]> = [
    ["a blank name", { name: "   " }],
    ["a name over 200 characters", { name: "n".repeat(201) }],
    ["a negative rank", { rank: -1 }],
    ["a fractional rank", { rank: 1.5 }],
    ["an infinite rank", { rank: Number.POSITIVE_INFINITY }],
    ["an unknown capability", { permissions: forgedCapability }],
  ];

  it.each(invalidRoles)("rejects %s without any write", async (_, change) => {
    const { world, service } = setup();
    world.addAdministrator();

    await expectRejection(
      service.saveRole("admin", { ...NEW_ROLE, ...change }),
      "invalidInput",
    );
    expect(world.writes).toEqual([]);
    expect(world.invalidations).toEqual([]);
  });
});

describe("saveRole by a delegated editor", () => {
  it("creates a role within its own rank and capabilities", async () => {
    const { world, service } = setup();
    addEditor(world);

    await service.saveRole("editor", {
      ...NEW_ROLE,
      rank: 5,
      permissions: [CAPABILITY.WRITE],
    });

    expect(world.store.roles.map((role) => role.id)).toContain("role-new");
  });

  it.each([
    ["a higher rank", { rank: 6 }],
    [
      "the role management capability",
      { permissions: [CAPABILITY.MANAGE_ROLES] },
    ],
    ["a capability the editor lacks", { permissions: [CAPABILITY.MILESTONES] }],
  ])("refuses to create a role with %s", async (_, change) => {
    const { world, service } = setup();
    addEditor(world);

    await expectRejection(
      service.saveRole("editor", { ...NEW_ROLE, ...change }),
      "forbidden",
    );
    expect(world.writes).toEqual([]);
    expect(world.invalidations).toEqual([]);
  });

  it("refuses an account without the role management capability", async () => {
    const { world, service } = setup();
    world.addAccount({
      userId: "clerk",
      rank: 9,
      permissions: [CAPABILITY.WRITE, CAPABILITY.MANAGE_USERS],
    });

    await expectRejection(
      service.saveRole("clerk", {
        ...NEW_ROLE,
        permissions: [CAPABILITY.WRITE],
      }),
      "forbidden",
    );
  });

  it("edits a lower role whose holders are all within scope", async () => {
    const { world, service } = setup();
    addEditor(world);
    const staff = world.addRole({ roleId: "role-staff", rank: 2 });
    world.addAccount({ userId: "bob", roleId: "role-staff", rank: 2 });

    await service.saveRole("editor", { ...staff, name: "Staff v2" });

    expect(
      world.store.roles.find((role) => role.id === "role-staff")?.name,
    ).toBe("Staff v2");
  });

  it("refuses to edit its own role", async () => {
    const { world, service } = setup();
    addEditor(world);
    const own = world.account("editor").role;

    await expectRejection(
      service.saveRole("editor", {
        ...NEW_ROLE,
        id: "role-editor",
        rank: own?.rank ?? 0,
        permissions: [CAPABILITY.WRITE],
      }),
      "forbidden",
    );
  });

  it("refuses to edit a role of a higher rank", async () => {
    const { world, service } = setup();
    addEditor(world);
    const boss = world.addRole({ roleId: "role-boss", rank: 9 });

    await expectRejection(
      service.saveRole("editor", { ...boss, rank: 1, permissions: [] }),
      "forbidden",
    );
  });

  it("refuses to edit a role while a holder is outside its scope", async () => {
    const { world, service } = setup();
    addEditor(world);
    const staff = world.addRole({ roleId: "role-staff", rank: 2 });
    world.addAccount({
      userId: "bob",
      roleId: "role-staff",
      rank: 2,
      departments: ["legal"],
    });

    await expectRejection(
      service.saveRole("editor", { ...staff, name: "Hijacked" }),
      "forbidden",
    );
    expect(world.writes).toEqual([]);
  });
});

describe("saveRole actors", () => {
  it("refuses an inactive actor", async () => {
    const { world, service } = setup();
    world.addAdministrator({ isActive: false });

    await expectRejection(service.saveRole("admin", NEW_ROLE), "forbidden");
  });

  it("refuses an administrator who works in role mode without a role", async () => {
    const { world, service } = setup();
    world.addAdministrator({ mode: "role" });

    await expectRejection(service.saveRole("admin", NEW_ROLE), "forbidden");
  });

  it("reports an unknown actor as not found", async () => {
    const { service } = setup();

    await expectRejection(service.saveRole("ghost", NEW_ROLE), "notFound");
  });
});

describe("deleteRole", () => {
  it("removes an unassigned role for an administrator", async () => {
    const { world, service } = setup();
    world.addAdministrator();
    world.addRole({ roleId: "role-spare" });

    await service.deleteRole("admin", "role-spare");

    expect(world.store.roles.map((role) => role.id)).not.toContain(
      "role-spare",
    );
  });

  it("reports an unknown role as not found", async () => {
    const { world, service } = setup();
    world.addAdministrator();

    await expectRejection(service.deleteRole("admin", "missing"), "notFound");
  });

  it("keeps a role that is still assigned", async () => {
    const { world, service } = setup();
    world.addAdministrator();
    world.addAccount({ userId: "bob", roleId: "role-staff" });

    await expectRejection(service.deleteRole("admin", "role-staff"), "inUse");
    expect(world.store.roles.map((role) => role.id)).toContain("role-staff");
  });

  it("lets a delegated editor remove an unassigned lower role", async () => {
    const { world, service } = setup();
    addEditor(world);
    world.addRole({ roleId: "role-spare", rank: 2 });

    await service.deleteRole("editor", "role-spare");

    expect(world.store.roles.map((role) => role.id)).not.toContain(
      "role-spare",
    );
  });

  it.each([
    ["a higher ranked role", "role-boss"],
    ["its own role", "role-editor"],
  ])("refuses a delegated editor deleting %s", async (_, roleId) => {
    const { world, service } = setup();
    addEditor(world);
    world.addRole({ roleId: "role-boss", rank: 9 });

    await expectRejection(service.deleteRole("editor", roleId), "forbidden");
  });

  it("reports a refused deletion before revealing that the role is in use", async () => {
    const { world, service } = setup();
    world.addAccount({ userId: "clerk", permissions: [CAPABILITY.WRITE] });
    world.addAccount({ userId: "bob", roleId: "role-staff" });

    await expectRejection(
      service.deleteRole("clerk", "role-staff"),
      "forbidden",
    );
  });
});
