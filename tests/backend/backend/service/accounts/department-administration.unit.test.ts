import { describe, expect, it } from "vitest";

import { DepartmentAdministrationService } from "@/backend/service/DepartmentAdministrationService";
import { CAPABILITY } from "@/definition/Authorization";

import { expectRejection, expectScopeLock } from "./administration-assertions";
import { AuthorizationWorld } from "./authorization-world";

interface DepartmentSetup {
  readonly world: AuthorizationWorld;
  readonly service: DepartmentAdministrationService;
}

function setup(): DepartmentSetup {
  const world = new AuthorizationWorld();
  world.addDepartment("sales", "Sales");
  world.addDepartment("legal", "Legal");

  return {
    world,
    service: new DepartmentAdministrationService(world.repository),
  };
}

/** Manages departments, but only the ones assigned to the account. */
function addDepartmentManager(world: AuthorizationWorld): void {
  world.addAccount({
    userId: "lead",
    roleId: "role-lead",
    permissions: [CAPABILITY.WRITE, CAPABILITY.MANAGE_DEPARTMENTS],
    departments: ["sales"],
    managedDepartments: ["sales"],
  });
}

describe("saveDepartment: creating", () => {
  it("stores a trimmed department and hands its management to the creator", async () => {
    const { world, service } = setup();
    world.addAdministrator();

    await service.saveDepartment("admin", { id: "ops", name: "  Operations " });

    expect(world.store.departments).toContainEqual({
      id: "ops",
      name: "Operations",
    });
    expect(world.account("admin").managedDepartments).toEqual(["ops"]);
  });

  it("lets a department manager create one and then manage it", async () => {
    const { world, service } = setup();
    addDepartmentManager(world);

    await service.saveDepartment("lead", { id: "ops", name: "Operations" });
    await service.saveDepartment("lead", { id: "ops", name: "Operations 2" });

    expect(world.account("lead").managedDepartments).toEqual(["sales", "ops"]);
    expect(
      world.store.departments.find((entry) => entry.id === "ops")?.name,
    ).toBe("Operations 2");
  });

  it("refuses an account without the department capability", async () => {
    const { world, service } = setup();
    world.addAccount({
      userId: "clerk",
      permissions: [CAPABILITY.WRITE, CAPABILITY.MANAGE_USERS],
      managedDepartments: ["sales"],
    });

    await expectRejection(
      service.saveDepartment("clerk", { id: "ops", name: "Operations" }),
      "forbidden",
    );
    expect(world.writes).toEqual([]);
  });

  it.each([
    ["a blank name", "   "],
    ["a name over 200 characters", "n".repeat(201)],
    ["the name of another department", " LEGAL "],
  ])("rejects %s without a write", async (_, name) => {
    const { world, service } = setup();
    world.addAdministrator();

    await expectRejection(
      service.saveDepartment("admin", { id: "ops", name }),
      "invalidInput",
    );
    expect(world.writes).toEqual([]);
  });
});

describe("saveDepartment: renaming", () => {
  it("renames a department in the managed range without new management rights", async () => {
    const { world, service } = setup();
    addDepartmentManager(world);

    await service.saveDepartment("lead", { id: "sales", name: "Sales EU" });

    expect(world.writes).toEqual(["saveDepartment:sales"]);
    expect(world.account("lead").managedDepartments).toEqual(["sales"]);
  });

  it("refuses a department outside the managed range", async () => {
    const { world, service } = setup();
    addDepartmentManager(world);

    await expectRejection(
      service.saveDepartment("lead", { id: "legal", name: "Legal EU" }),
      "forbidden",
    );
    expect(
      world.store.departments.find((entry) => entry.id === "legal")?.name,
    ).toBe("Legal");
  });

  it("accepts every department for an account that manages all of them", async () => {
    const { world, service } = setup();
    world.addAccount({
      userId: "lead",
      permissions: [CAPABILITY.MANAGE_DEPARTMENTS],
      allDepartments: true,
    });

    await expect(
      service.saveDepartment("lead", { id: "legal", name: "Legal EU" }),
    ).resolves.toBeUndefined();
  });

  it("lets a department keep its name when it is renamed in case only", async () => {
    const { world, service } = setup();
    world.addAdministrator();

    await service.saveDepartment("admin", { id: "sales", name: "SALES" });

    expect(
      world.store.departments.find((entry) => entry.id === "sales")?.name,
    ).toBe("SALES");
  });

  it("refuses an inactive actor", async () => {
    const { world, service } = setup();
    world.addAdministrator({ isActive: false });

    await expectRejection(
      service.saveDepartment("admin", { id: "sales", name: "Sales EU" }),
      "forbidden",
    );
  });
});

describe("deleteDepartment", () => {
  it("removes a department in the managed range", async () => {
    const { world, service } = setup();
    addDepartmentManager(world);

    await service.deleteDepartment("lead", "sales");

    expect(world.store.departments.map((entry) => entry.id)).toEqual(["legal"]);
  });

  it("lets an administrator remove any department", async () => {
    const { world, service } = setup();
    world.addAdministrator();

    await service.deleteDepartment("admin", "legal");

    expect(world.store.departments.map((entry) => entry.id)).toEqual(["sales"]);
  });

  it("refuses a department outside the managed range", async () => {
    const { world, service } = setup();
    addDepartmentManager(world);

    await expectRejection(
      service.deleteDepartment("lead", "legal"),
      "forbidden",
    );
    expect(world.writes).toEqual([]);
  });

  it("refuses a managed department without the department capability", async () => {
    const { world, service } = setup();
    world.addAccount({
      userId: "clerk",
      permissions: [CAPABILITY.WRITE],
      managedDepartments: ["sales"],
    });

    await expectRejection(
      service.deleteDepartment("clerk", "sales"),
      "forbidden",
    );
  });

  it("keeps a department that agents or connections still use", async () => {
    const { world, service } = setup();
    world.addAdministrator();
    world.store.agentProfileReferences.set("department:sales", [
      { id: "a1", name: "Sales agent" },
    ]);
    world.store.connectionReferences.set("department:sales", [
      { id: "c1", name: "Sales connection" },
    ]);

    await expectScopeLock(service.deleteDepartment("admin", "sales"), [
      "Sales agent",
      "Sales connection",
    ]);
    expect(world.store.departments.map((entry) => entry.id)).toContain("sales");
    expect(world.writes).toEqual([]);
  });

  it("keeps the agent names from a department manager", async () => {
    const { world, service } = setup();
    addDepartmentManager(world);
    world.store.agentProfileReferences.set("department:sales", [
      { id: "a1", name: "Sales agent" },
    ]);

    await expectScopeLock(service.deleteDepartment("lead", "sales"), []);
  });
});
