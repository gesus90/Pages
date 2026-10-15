import { describe, expect, it } from "vitest";

import { GroupAdministrationService } from "@/backend/service/GroupAdministrationService";
import { CAPABILITY } from "@/definition/Authorization";

import { expectRejection, expectScopeLock } from "./administration-assertions";
import { AuthorizationWorld } from "./authorization-world";

import type { UserGroup } from "@/definition/UserGroup";

interface GroupSetup {
  readonly world: AuthorizationWorld;
  readonly service: GroupAdministrationService;
}

/**
 * An administrator, a sales manager, one person in sales, one in legal and one
 * without department; the manager only sees sales and the departmentless.
 */
function setup(): GroupSetup {
  const world = new AuthorizationWorld();
  world.addAdministrator();
  world.addAccount({
    userId: "manager",
    roleId: "role-manager",
    rank: 5,
    permissions: [CAPABILITY.WRITE, CAPABILITY.MANAGE_USERS],
    departments: ["sales"],
  });
  world.addAccount({ userId: "sales-1", departments: ["sales"] });
  world.addAccount({ userId: "legal-1", departments: ["legal"] });
  world.addAccount({ userId: "loose-1" });

  return {
    world,
    service: new GroupAdministrationService(world.repository, world.cache),
  };
}

const NEW_GROUP: UserGroup = {
  id: "g-new",
  name: "  Support ",
  memberIds: ["sales-1", "loose-1"],
};

describe("pageData", () => {
  it("shows nothing to an account that may not manage users", async () => {
    const { world, service } = setup();
    world.addAccount({ userId: "writer", permissions: [CAPABILITY.WRITE] });
    world.addGroup({ id: "g1", name: "Core", memberIds: ["sales-1"] });

    await expect(service.pageData("writer")).resolves.toEqual({
      canManage: false,
      groups: [],
    });
  });

  it("shows every group to an administrator, including empty ones", async () => {
    const { world, service } = setup();
    world.addGroup({ id: "g1", name: "Core", memberIds: ["legal-1"] });
    world.addGroup({ id: "g2", name: "Empty", memberIds: [] });

    const page = await service.pageData("admin");

    expect(page.canManage).toBe(true);
    expect(page.groups.map((group) => [group.id, group.canEdit])).toEqual([
      ["g1", true],
      ["g2", true],
    ]);
  });

  it("limits a manager to groups with a visible member and hides the others", async () => {
    const { world, service } = setup();
    world.addGroup({
      id: "mixed",
      name: "Mixed",
      memberIds: ["sales-1", "legal-1"],
    });
    world.addGroup({ id: "legal", name: "Legal", memberIds: ["legal-1"] });
    world.addGroup({ id: "empty", name: "Empty", memberIds: [] });

    const page = await service.pageData("manager");

    expect(page.groups.map((group) => group.id)).toEqual(["mixed", "empty"]);
    const mixed = page.groups.find((group) => group.id === "mixed");
    expect(mixed).toMatchObject({
      memberCount: 2,
      memberIds: ["sales-1"],
      canEdit: false,
    });
    expect(page.groups.find((group) => group.id === "empty")?.canEdit).toBe(
      true,
    );
  });
});

describe("saveGroup", () => {
  it("creates a group with a trimmed name and refreshes work items", async () => {
    const { world, service } = setup();

    await service.saveGroup("admin", NEW_GROUP);

    expect(world.store.groups).toEqual([{ ...NEW_GROUP, name: "Support" }]);
    expect(world.invalidations).toEqual(["invalidateWorkItems"]);
  });

  it("lets a manager group people within the visible range", async () => {
    const { world, service } = setup();

    await service.saveGroup("manager", NEW_GROUP);

    expect(world.store.groups.map((group) => group.id)).toEqual(["g-new"]);
  });

  it("refuses a manager adding a person outside the visible range", async () => {
    const { world, service } = setup();

    await expectRejection(
      service.saveGroup("manager", {
        ...NEW_GROUP,
        memberIds: ["sales-1", "legal-1"],
      }),
      "forbidden",
    );
    expect(world.store.groups).toEqual([]);
    expect(world.invalidations).toEqual([]);
  });

  it("refuses a manager taking over a group with a member out of scope", async () => {
    const { world, service } = setup();
    world.addGroup({ id: "g1", name: "Core", memberIds: ["legal-1"] });

    await expectRejection(
      service.saveGroup("manager", {
        id: "g1",
        name: "Core",
        memberIds: ["sales-1"],
      }),
      "forbidden",
    );
    expect(world.store.groups[0]?.memberIds).toEqual(["legal-1"]);
  });

  it("refuses an account that may not manage users", async () => {
    const { world, service } = setup();
    world.addAccount({ userId: "writer", permissions: [CAPABILITY.WRITE] });

    await expectRejection(service.saveGroup("writer", NEW_GROUP), "forbidden");
  });

  it("refuses an inactive actor", async () => {
    const { world, service } = setup();
    world.setUserActive("admin", false);

    await expectRejection(service.saveGroup("admin", NEW_GROUP), "forbidden");
  });
});

describe("saveGroup validation", () => {
  const invalidGroups: ReadonlyArray<readonly [string, Partial<UserGroup>]> = [
    ["a blank name", { name: "  " }],
    ["a name over 200 characters", { name: "n".repeat(201) }],
    ["no members", { memberIds: [] }],
    ["an unknown member", { memberIds: ["sales-1", "ghost"] }],
  ];

  it.each(invalidGroups)("rejects %s", async (_, change) => {
    const { world, service } = setup();

    await expectRejection(
      service.saveGroup("admin", { ...NEW_GROUP, ...change }),
      "invalidInput",
    );
    expect(world.writes).toEqual([]);
  });

  it("rejects an inactive member", async () => {
    const { world, service } = setup();
    world.setUserActive("sales-1", false);

    await expectRejection(
      service.saveGroup("admin", NEW_GROUP),
      "invalidInput",
    );
    expect(world.writes).toEqual([]);
  });

  it("rejects the name of another group regardless of case", async () => {
    const { world, service } = setup();
    world.addGroup({ id: "g1", name: "support", memberIds: ["loose-1"] });

    await expectRejection(
      service.saveGroup("admin", NEW_GROUP),
      "invalidInput",
    );
  });

  it("lets a group keep its name while its members change", async () => {
    const { world, service } = setup();
    world.addGroup({ id: "g-new", name: "SUPPORT", memberIds: ["loose-1"] });

    await service.saveGroup("admin", NEW_GROUP);

    expect(world.store.groups).toEqual([{ ...NEW_GROUP, name: "Support" }]);
  });
});

describe("deleteGroup", () => {
  it("deletes a group in scope and refreshes work items", async () => {
    const { world, service } = setup();
    world.addGroup({ id: "g1", name: "Core", memberIds: ["sales-1"] });

    await service.deleteGroup("manager", "g1");

    expect(world.store.groups).toEqual([]);
    expect(world.invalidations).toEqual(["invalidateWorkItems"]);
  });

  it("reports an unknown group as not found", async () => {
    const { service } = setup();

    await expectRejection(service.deleteGroup("admin", "missing"), "notFound");
  });

  it("refuses a group with a member outside the actor's scope", async () => {
    const { world, service } = setup();
    world.addGroup({
      id: "g1",
      name: "Core",
      memberIds: ["sales-1", "legal-1"],
    });

    await expectRejection(service.deleteGroup("manager", "g1"), "forbidden");
    expect(world.store.groups).toHaveLength(1);
  });

  it("keeps a group that agents or connections still use", async () => {
    const { world, service } = setup();
    world.addGroup({ id: "g1", name: "Core", memberIds: ["sales-1"] });
    world.store.agentProfileReferences.set("group:g1", [
      { id: "a1", name: "Core agent" },
    ]);

    await expectScopeLock(service.deleteGroup("admin", "g1"), ["Core agent"]);
    await expectScopeLock(service.deleteGroup("manager", "g1"), []);
    expect(world.store.groups).toHaveLength(1);
    expect(world.invalidations).toEqual([]);
  });
});
