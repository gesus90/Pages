import { describe, expect, it } from "vitest";

import { CAPABILITY } from "@/definition/Authorization";

import { expectRejection } from "./administration-assertions";
import { organizationWorld } from "./administration-directory";

import type { ManagementScopeInput } from "@/definition/Authorization";

describe("assignRole", () => {
  it("assigns a role and refreshes the legacy role projection", async () => {
    const world = organizationWorld();
    world.addRole({
      roleId: "role-planner",
      rank: 2,
      permissions: [CAPABILITY.WRITE, CAPABILITY.MANAGE_PROJECTS],
    });

    await world.service().assignRole("admin", "loose", "role-planner");

    expect(world.account("loose").role?.id).toBe("role-planner");
    expect(world.user("loose").role).toBe("manager");
    expect(world.invalidations).toEqual(["invalidateProjectMembership"]);
  });

  it("lets a role manager assign a role within its own reach", async () => {
    const world = organizationWorld();

    await world.service().assignRole("hr", "emp-sales", "role-writer");

    expect(world.account("emp-sales").role?.id).toBe("role-writer");
  });

  it("refuses a role of a higher rank", async () => {
    const world = organizationWorld();
    world.addRole({ roleId: "role-director", rank: 9 });

    await expectRejection(
      world.service().assignRole("hr", "emp-sales", "role-director"),
      "forbidden",
    );
    expect(world.account("emp-sales").role?.id).toBe("role-employee");
  });

  it("refuses a role that carries the role management capability", async () => {
    const world = organizationWorld();

    await expectRejection(
      world.service().assignRole("hr", "emp-sales", "role-hr"),
      "forbidden",
    );
  });

  it.each([
    ["the own account", "hr", "hr"],
    ["a person outside the department scope", "hr", "emp-legal"],
    ["a person without the capability to assign", "lead", "emp-sales"],
  ])("refuses a change of %s", async (_, actor, target) => {
    const world = organizationWorld();

    await expectRejection(
      world.service().assignRole(actor, target, "role-writer"),
      "forbidden",
    );
    expect(world.writes).toEqual([]);
  });

  it("reports an unknown role as not found only to an authorized actor", async () => {
    const world = organizationWorld();

    await expectRejection(
      world.service().assignRole("hr", "emp-sales", "role-missing"),
      "notFound",
    );
    await expectRejection(
      world.service().assignRole("writer", "emp-sales", "role-missing"),
      "forbidden",
    );
  });
});

describe("setScope", () => {
  const SCOPE: ManagementScopeInput = {
    managedDepartments: ["legal"],
    allDepartments: false,
    allProjects: true,
  };

  it("lets an administrator set a personal management range", async () => {
    const world = organizationWorld();

    await world.service().setScope("admin", "lead", SCOPE);

    expect(world.account("lead")).toMatchObject(SCOPE);
    expect(world.invalidations).toEqual(["invalidateProjectMembership"]);
  });

  it.each([
    ["a department manager for another person", "lead", "emp-sales"],
    ["a department manager for itself", "lead", "lead"],
    ["a user manager", "hr", "emp-sales"],
  ])("refuses %s", async (_, actor, target) => {
    const world = organizationWorld();

    await expectRejection(
      world.service().setScope(actor, target, SCOPE),
      "forbidden",
    );
    expect(world.account(target).allProjects).toBe(false);
  });

  it("rejects an unknown department", async () => {
    const world = organizationWorld();

    await expectRejection(
      world.service().setScope("admin", "lead", {
        ...SCOPE,
        managedDepartments: ["missing"],
      }),
      "invalidInput",
    );
    expect(world.writes).toEqual([]);
  });

  it("reports an unknown target as not found", async () => {
    await expectRejection(
      organizationWorld().service().setScope("admin", "ghost", SCOPE),
      "notFound",
    );
  });
});

describe("setMemberships", () => {
  it("places a departmentless person in a managed department", async () => {
    const world = organizationWorld();

    await world.service().setMemberships("lead", "loose", ["sales"]);

    expect(world.account("loose").departments).toEqual(["sales"]);
    expect(world.invalidations).toEqual(["invalidateProjectMembership"]);
  });

  it("lets a role manager place a person in its own department", async () => {
    const world = organizationWorld();

    await world.service().setMemberships("hr", "loose", ["sales"]);

    expect(world.account("loose").departments).toEqual(["sales"]);
  });

  it("refuses a department outside the actor's range", async () => {
    const world = organizationWorld();

    await expectRejection(
      world.service().setMemberships("lead", "loose", ["legal"]),
      "forbidden",
    );
    await expectRejection(
      world.service().setMemberships("hr", "loose", ["legal"]),
      "forbidden",
    );
    expect(world.account("loose").departments).toEqual([]);
  });

  it("refuses to move a member into a department the actor does not manage", async () => {
    const world = organizationWorld();

    await expectRejection(
      world.service().setMemberships("lead", "emp-sales", ["sales", "legal"]),
      "forbidden",
    );
    expect(world.account("emp-sales").departments).toEqual(["sales"]);
  });

  it("refuses to leave a person who had a department without one", async () => {
    const world = organizationWorld();

    await expectRejection(
      world.service().setMemberships("admin", "emp-sales", []),
      "forbidden",
    );
    expect(world.account("emp-sales").departments).toEqual(["sales"]);
  });

  it("lets an administrator reassign a person to another department", async () => {
    const world = organizationWorld();

    await world.service().setMemberships("admin", "emp-sales", ["legal"]);

    expect(world.account("emp-sales").departments).toEqual(["legal"]);
  });

  it("rejects an unknown department", async () => {
    const world = organizationWorld();

    await expectRejection(
      world.service().setMemberships("admin", "loose", ["missing"]),
      "invalidInput",
    );
    expect(world.writes).toEqual([]);
  });

  it("refuses a non-administrator changing its own memberships", async () => {
    const world = organizationWorld();

    await expectRejection(
      world.service().setMemberships("lead", "lead", ["sales", "legal"]),
      "forbidden",
    );
  });
});
