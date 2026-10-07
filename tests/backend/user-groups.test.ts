import { describe, expect, it } from "vitest";

import { PasswordHasher } from "@/backend/auth/PasswordHasher";
import { ServerCache } from "@/backend/cache/ServerCache";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { AdministrationService } from "@/backend/service/AdministrationService";
import { GroupAdministrationService } from "@/backend/service/GroupAdministrationService";
import { CAPABILITY } from "@/definition/Authorization";
import { createAccess, createRole } from "../helpers/authorization";
import { useMigratedDatabase } from "../helpers/test-database";

const MANAGER_ROLE = createRole({
  id: "manager-role",
  permissions: [CAPABILITY.MANAGE_USERS],
});
const PLAIN_ROLE = createRole({
  id: "plain-role",
  name: "Plain",
  permissions: [CAPABILITY.WRITE],
});

describe("user groups", () => {
  const getDatabase = useMigratedDatabase();

  async function setup() {
    const database = getDatabase();
    const repository = new AuthorizationRepository(database);
    const cache = new ServerCache();
    await database.execute(
      "INSERT INTO departments (id, name) VALUES ('front', 'Front'), ('back', 'Back');",
    );
    await repository.saveRole(MANAGER_ROLE);
    await repository.saveRole(PLAIN_ROLE);
    const accounts = [
      createAccess({
        userId: "admin",
        isAdmin: true,
        mode: "admin",
        role: null,
        departments: [],
      }),
      createAccess({
        userId: "manager",
        role: MANAGER_ROLE,
        departments: ["front"],
        managedDepartments: [],
      }),
      createAccess({
        userId: "near",
        role: PLAIN_ROLE,
        departments: ["front"],
        managedDepartments: [],
      }),
      createAccess({
        userId: "far",
        role: PLAIN_ROLE,
        departments: ["back"],
        managedDepartments: [],
      }),
    ];
    for (const account of accounts) {
      await repository.users().insert({
        id: account.userId,
        username: account.userId,
        displayName: account.userId,
        passwordHash: "hash",
        role: "employee",
      });
      await repository.saveAccount(account);
    }
    return {
      database,
      cache,
      groups: new GroupAdministrationService(repository, cache),
      administration: new AdministrationService(
        repository,
        cache,
        new PasswordHasher(),
      ),
    };
  }

  async function groupRows(
    groups: GroupAdministrationService,
    userId: string,
  ): Promise<readonly string[]> {
    return (await groups.pageData(userId)).groups.map((group) => group.name);
  }

  it("creates, renames and lists a group with its members", async () => {
    const { groups } = await setup();

    await groups.saveGroup("admin", {
      id: "g1",
      name: "  Platform  ",
      memberIds: ["near", "far", "near"],
    });
    await groups.saveGroup("admin", {
      id: "g1",
      name: "Platform team",
      memberIds: ["near"],
    });

    const page = await groups.pageData("admin");
    expect(page.canManage).toBe(true);
    expect(page.groups).toEqual([
      {
        canEdit: true,
        id: "g1",
        memberCount: 1,
        memberIds: ["near"],
        name: "Platform team",
      },
    ]);
  });

  it("rejects groups without a name, a free name or active members", async () => {
    const { groups, administration } = await setup();
    await groups.saveGroup("admin", {
      id: "g1",
      name: "Platform",
      memberIds: ["near"],
    });
    await administration.setActive("admin", "far", false);

    const invalid = [
      { id: "a", name: "   ", memberIds: ["near"] },
      { id: "a", name: "x".repeat(201), memberIds: ["near"] },
      { id: "a", name: "Alone", memberIds: [] },
      { id: "a", name: "Ghost", memberIds: ["missing"] },
      { id: "a", name: "Gone", memberIds: ["far"] },
      { id: "a", name: "PLATFORM", memberIds: ["near"] },
    ];
    for (const input of invalid) {
      await expect(groups.saveGroup("admin", input)).rejects.toThrow(
        "invalidInput",
      );
    }
    expect(await groupRows(groups, "admin")).toEqual(["Platform"]);
  });

  it("keeps managers within the scope of the users they may see", async () => {
    const { groups } = await setup();
    await groups.saveGroup("admin", {
      id: "mixed",
      name: "Mixed",
      memberIds: ["near", "far"],
    });
    await groups.saveGroup("admin", {
      id: "far-only",
      name: "Far only",
      memberIds: ["far"],
    });
    await groups.saveGroup("admin", {
      id: "near-only",
      name: "Near only",
      memberIds: ["near"],
    });

    expect(await groupRows(groups, "manager")).toEqual(["Mixed", "Near only"]);
    const page = await groups.pageData("manager");
    expect(page.groups.map((group) => [group.id, group.canEdit])).toEqual([
      ["mixed", false],
      ["near-only", true],
    ]);
    expect(page.groups[0]?.memberIds).toEqual(["near"]);
    expect(page.groups[0]?.memberCount).toBe(2);

    await expect(
      groups.saveGroup("manager", {
        id: "mixed",
        name: "Renamed",
        memberIds: ["near"],
      }),
    ).rejects.toThrow("forbidden");
    await expect(
      groups.saveGroup("manager", {
        id: "new",
        name: "New",
        memberIds: ["far"],
      }),
    ).rejects.toThrow("forbidden");
    await expect(groups.deleteGroup("manager", "mixed")).rejects.toThrow(
      "forbidden",
    );
    await groups.saveGroup("manager", {
      id: "new",
      name: "New",
      memberIds: ["manager", "near"],
    });
    expect(await groupRows(groups, "manager")).toContain("New");
  });

  it("denies everything to people who may not manage users", async () => {
    const { groups } = await setup();
    await groups.saveGroup("admin", {
      id: "g1",
      name: "Platform",
      memberIds: ["near"],
    });

    expect(await groups.pageData("near")).toEqual({
      canManage: false,
      groups: [],
    });
    await expect(
      groups.saveGroup("near", { id: "g2", name: "X", memberIds: ["near"] }),
    ).rejects.toThrow("forbidden");
    await expect(groups.deleteGroup("near", "g1")).rejects.toThrow("forbidden");
    await expect(groups.pageData("missing")).rejects.toThrow("notFound");
  });

  it("lists empty groups to managers and lets them add members", async () => {
    const { groups, administration } = await setup();
    await groups.saveGroup("admin", {
      id: "g1",
      name: "Platform",
      memberIds: ["near"],
    });
    await administration.setActive("admin", "near", false);

    const page = await groups.pageData("manager");
    expect(page.groups).toEqual([
      {
        canEdit: true,
        id: "g1",
        memberCount: 0,
        memberIds: [],
        name: "Platform",
      },
    ]);
    await groups.saveGroup("manager", {
      id: "g1",
      name: "Platform",
      memberIds: ["manager"],
    });
    expect((await groups.pageData("manager")).groups[0]?.memberCount).toBe(1);
  });

  it("removes deactivated users from groups and leaves the group empty", async () => {
    const { groups, administration, database } = await setup();
    await groups.saveGroup("admin", {
      id: "g1",
      name: "Platform",
      memberIds: ["near"],
    });

    await administration.setActive("admin", "near", false);

    const rows = await database.query(
      "SELECT user_id FROM user_group_members WHERE group_id = 'g1';",
    );
    expect(rows).toEqual([]);
    expect(await groupRows(groups, "admin")).toEqual(["Platform"]);
  });

  it("deletes a group, its members and the ticket assignments to it", async () => {
    const { groups, database, cache } = await setup();
    await groups.saveGroup("admin", {
      id: "g1",
      name: "Platform",
      memberIds: ["near"],
    });
    await database.execute(`
      INSERT INTO projects (id, name, owner_id) VALUES ('p1', 'Project', 'near');
      INSERT INTO work_items (id, project_id, key, number, type, title, status_id, created_by, assignee_group_id, sort_order)
      VALUES ('t1', 'p1', 'PAGE-1', 1, 'task', 'Task', 'status-todo', 'near', 'g1', 1);
    `);
    cache.set("workitems:q:probe", [], 1000);

    await groups.deleteGroup("admin", "g1");

    expect(
      await database.query("SELECT assignee_group_id FROM work_items;"),
    ).toEqual([[null]]);
    expect(await database.query("SELECT id FROM user_groups;")).toEqual([]);
    expect(cache.get("workitems:q:probe")).toBeUndefined();
    await expect(groups.deleteGroup("admin", "g1")).rejects.toThrow("notFound");
  });

  it("includes the group section in the administration page", async () => {
    const { groups, administration } = await setup();
    await groups.saveGroup("admin", {
      id: "g1",
      name: "Platform",
      memberIds: ["near"],
    });

    const page = await administration.pageData("manager");

    expect(page.groups.canManage).toBe(true);
    expect(page.groups.groups.map((group) => group.name)).toEqual(["Platform"]);
  });
});
