import { describe, expect, it } from "vitest";

import { expectRejection } from "./administration-assertions";
import { organizationWorld } from "./administration-directory";

import type { AuthorizationWorld } from "./authorization-world";

function withSecondAdministrator(): AuthorizationWorld {
  const world = organizationWorld();
  world.addAdministrator({
    userId: "admin-2",
    hasRole: true,
    roleId: "role-hr",
    rank: 5,
  });

  return world;
}

describe("setActive", () => {
  it("deactivates a person and refreshes users and work items", async () => {
    const world = organizationWorld();

    await world.service().setActive("admin", "emp-sales", false);

    expect(world.user("emp-sales").isActive).toBe(false);
    expect(world.invalidations).toEqual([
      "invalidateUsers",
      "invalidateWorkItems",
    ]);
  });

  it("reactivates a person", async () => {
    const world = organizationWorld();
    world.setUserActive("emp-sales", false);

    await world.service().setActive("hr", "emp-sales", true);

    expect(world.user("emp-sales").isActive).toBe(true);
  });

  it.each([
    ["an account without user management", "writer", "loose"],
    ["a non-administrator deactivating itself", "hr", "hr"],
    ["a person outside the department scope", "hr", "emp-legal"],
    ["an administrator account", "lead", "admin"],
  ])("refuses %s", async (_, actor, target) => {
    const world = organizationWorld();

    await expectRejection(
      world.service().setActive(actor, target, false),
      "forbidden",
    );
    expect(world.writes).toEqual([]);
    expect(world.invalidations).toEqual([]);
  });

  it("keeps the last active administrator", async () => {
    const world = organizationWorld();

    await expectRejection(
      world.service().setActive("admin", "admin", false),
      "lastAdministrator",
    );
    expect(world.user("admin").isActive).toBe(true);
    expect(world.invalidations).toEqual([]);
  });

  it("lets an administrator step down while another one remains", async () => {
    const world = withSecondAdministrator();

    await world.service().setActive("admin", "admin", false);

    expect(world.user("admin").isActive).toBe(false);
  });

  it("does not count an inactive administrator as a successor", async () => {
    const world = withSecondAdministrator();
    world.setUserActive("admin-2", false);

    await expectRejection(
      world.service().setActive("admin", "admin", false),
      "lastAdministrator",
    );
  });
});

describe("setAdministrator", () => {
  it("grants the eligibility without changing the active mode", async () => {
    const world = organizationWorld();

    await world.service().setAdministrator("admin", "emp-sales", true);

    expect(world.account("emp-sales")).toMatchObject({
      isAdmin: true,
      mode: "role",
      role: { id: "role-employee" },
    });
    expect(world.user("emp-sales").role).toBe("employee");
    expect(world.invalidations).toEqual(["invalidateProjectMembership"]);
  });

  it.each([
    ["a user manager", "hr"],
    ["a department manager", "lead"],
  ])("refuses %s", async (_, actor) => {
    const world = organizationWorld();

    await expectRejection(
      world.service().setAdministrator(actor, "emp-sales", true),
      "forbidden",
    );
    expect(world.account("emp-sales").isAdmin).toBe(false);
  });

  it("refuses an administrator who works in role mode", async () => {
    const world = organizationWorld();
    world.addAdministrator({
      userId: "admin-2",
      hasRole: true,
      roleId: "role-hr",
      mode: "role",
    });

    await expectRejection(
      world.service().setAdministrator("admin-2", "emp-sales", true),
      "forbidden",
    );
  });

  it("removes the eligibility and returns the person to role mode", async () => {
    const world = withSecondAdministrator();

    await world.service().setAdministrator("admin", "admin-2", false);

    expect(world.account("admin-2")).toMatchObject({
      isAdmin: false,
      mode: "role",
    });
  });

  it("refuses to remove the eligibility of an account without a role", async () => {
    const world = withSecondAdministrator();

    await expectRejection(
      world.service().setAdministrator("admin-2", "admin", false),
      "invalidInput",
    );
    expect(world.account("admin").isAdmin).toBe(true);
  });

  it("keeps the last active administrator", async () => {
    const world = organizationWorld();

    await expectRejection(
      world.service().setAdministrator("admin", "admin", false),
      "lastAdministrator",
    );
    expect(world.account("admin").isAdmin).toBe(true);
  });

  it("reports an unknown target as not found", async () => {
    await expectRejection(
      organizationWorld().service().setAdministrator("admin", "ghost", true),
      "notFound",
    );
  });
});

describe("setMode", () => {
  it("lets an eligible administrator switch to the role mode and back", async () => {
    const world = withSecondAdministrator();
    const service = world.service();

    await service.setMode("admin-2", "role");
    expect(world.account("admin-2").mode).toBe("role");
    expect(world.user("admin-2").role).toBe("employee");

    await service.setMode("admin-2", "admin");
    expect(world.account("admin-2").mode).toBe("admin");
    expect(world.user("admin-2").role).toBe("admin");
    expect(world.invalidations).toEqual([
      "invalidateProjectMembership",
      "invalidateProjectMembership",
    ]);
  });

  it("refuses the role mode without a role", async () => {
    const world = organizationWorld();

    await expectRejection(
      world.service().setMode("admin", "role"),
      "forbidden",
    );
    expect(world.account("admin").mode).toBe("admin");
  });

  it("refuses the administrator mode for an account that is not eligible", async () => {
    const world = organizationWorld();

    await expectRejection(world.service().setMode("hr", "admin"), "forbidden");
    expect(world.account("hr").mode).toBe("role");
  });

  it("refuses an inactive account", async () => {
    const world = withSecondAdministrator();
    world.setUserActive("admin-2", false);

    await expectRejection(
      world.service().setMode("admin-2", "role"),
      "forbidden",
    );
  });
});
