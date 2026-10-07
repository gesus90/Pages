import { describe, expect, it, vi } from "vitest";

import { PermissionService } from "@/backend/auth/PermissionService";
import { ServerCache } from "@/backend/cache/ServerCache";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { ProjectService } from "@/backend/service/ProjectService";
import { TaskService } from "@/backend/service/TaskService";
import { CAPABILITY } from "@/definition/Authorization";
import { createAccess, createRole } from "../helpers/authorization";
import { createUser } from "../helpers/factories";
import { useMigratedDatabase } from "../helpers/test-database";

import type { AccountAccess } from "@/definition/Authorization";
import type { CreateWorkItemInput } from "@/backend/service/TaskService";

const WRITER_ROLE = createRole({
  id: "writer",
  name: "Writer",
  permissions: [CAPABILITY.WRITE],
});
const ALICE = createUser({ id: "alice" });
const BOB = createUser({ id: "bob" });

const ACCOUNTS: readonly AccountAccess[] = [
  createAccess({
    userId: "alice",
    role: WRITER_ROLE,
    departments: ["frontend"],
    managedDepartments: [],
  }),
  createAccess({
    userId: "bob",
    role: WRITER_ROLE,
    departments: ["frontend"],
    managedDepartments: [],
  }),
  createAccess({
    userId: "outsider",
    role: WRITER_ROLE,
    departments: ["support"],
    managedDepartments: [],
  }),
];

const NEW_TASK: CreateWorkItemInput = {
  projectId: "p1",
  statusId: "status-todo",
  title: "Ticket",
  type: "task",
};

describe("ticket assignment to a person or a group", () => {
  const getDatabase = useMigratedDatabase();

  async function setup() {
    const database = getDatabase();
    const authorization = new AuthorizationRepository(database);
    await database.execute(`
      INSERT INTO departments (id, name)
      VALUES ('frontend', 'Frontend'), ('support', 'Support');
    `);
    await authorization.saveRole(WRITER_ROLE);
    for (const account of ACCOUNTS) {
      await authorization.users().insert({
        id: account.userId,
        username: account.userId,
        displayName: account.userId,
        passwordHash: "hash",
        // The legacy projection stays "admin" to prove it no longer decides.
        role: account.userId === "outsider" ? "admin" : "employee",
      });
      await authorization.saveAccount(account);
    }
    await database.execute(`
      INSERT INTO projects (id, name, owner_id)
      VALUES ('p1', 'First', 'alice'), ('p2', 'Second', 'alice');
      INSERT INTO project_departments (project_id, department_id)
      VALUES ('p1', 'frontend'), ('p2', 'frontend');
      INSERT INTO user_groups (id, name)
      VALUES ('team', 'Team'), ('ghosts', 'Ghosts');
      INSERT INTO user_group_members (group_id, user_id)
      VALUES ('team', 'bob'), ('team', 'outsider');
    `);
    const cache = new ServerCache();
    const repository = new TaskRepository(database);
    const permissions = new PermissionService(async (userId) => {
      const account = ACCOUNTS.find((entry) => entry.userId === userId);
      if (!account) throw new Error("unknown account");
      return account;
    });
    return {
      database,
      tasks: new TaskService(
        repository,
        new ProjectService(
          new ProjectRepository(database),
          permissions,
          null,
          cache,
        ),
        permissions,
        cache,
      ),
    };
  }

  it("assigns a group whose members need no project access", async () => {
    const { tasks } = await setup();

    const created = await tasks.create(ALICE, {
      ...NEW_TASK,
      assigneeGroupId: "team",
    });

    expect(created.assigneeGroupId).toBe("team");
    expect(created.assigneeGroupName).toBe("Team");
    expect(created.assigneeId).toBeNull();
    expect(created.assigneeName).toBeNull();
  });

  it("never accepts a person and a group at once, or an unusable group", async () => {
    const { tasks } = await setup();

    await expect(
      tasks.create(ALICE, {
        ...NEW_TASK,
        assigneeGroupId: "team",
        assigneeId: "bob",
      }),
    ).rejects.toThrow("not to both");
    await expect(
      tasks.create(ALICE, { ...NEW_TASK, assigneeGroupId: "nowhere" }),
    ).rejects.toThrow("does not exist");
    await expect(
      tasks.create(ALICE, { ...NEW_TASK, assigneeGroupId: "ghosts" }),
    ).rejects.toThrow("no members");
  });

  it("offers only people with project access, not by legacy role", async () => {
    const { tasks } = await setup();

    const names = (await tasks.findEligibleAssignees(ALICE, "p1")).map(
      (user) => user.id,
    );
    const byProject = await tasks.findAssigneesByProjects(["p1"]);

    expect(names).toEqual(["alice", "bob"]);
    expect(byProject.get("p1")?.map((user) => user.id)).toEqual([
      "alice",
      "bob",
    ]);
    await expect(
      tasks.create(ALICE, { ...NEW_TASK, assigneeId: "outsider" }),
    ).rejects.toThrow("does not have access");
  });

  it("switches between person and group and records it in the history", async () => {
    const { tasks } = await setup();
    const created = await tasks.create(ALICE, {
      ...NEW_TASK,
      assigneeId: "bob",
    });
    const base = {
      assigneeId: null,
      description: "",
      dueAt: null,
      milestoneId: null,
      parentId: null,
      priority: created.priority,
      reporterId: "alice",
      startAt: null,
      statusId: created.statusId,
      title: created.title,
    } as const;

    const toGroup = await tasks.update(ALICE, created.id, {
      ...base,
      assigneeGroupId: "team",
    });
    const toNobody = await tasks.update(ALICE, created.id, base);
    const toPerson = await tasks.update(ALICE, created.id, {
      ...base,
      assigneeId: "alice",
    });

    expect(toGroup.assigneeGroupName).toBe("Team");
    expect(toGroup.assigneeId).toBeNull();
    expect(toNobody.assigneeGroupId).toBeNull();
    expect(toPerson.assigneeName).toBe("alice");
    const changes = (await tasks.getHistory(ALICE, created.id))
      .filter((entry) => entry.action === "assignee_changed")
      .map((entry) => [entry.oldValue, entry.newValue]);
    expect(changes).toContainEqual(["bob", "Team"]);
    expect(changes).toContainEqual(["Team", null]);
    expect(changes).toContainEqual([null, "alice"]);
  });

  it("records no name when the group vanishes while the ticket is saved", async () => {
    const { tasks } = await setup();
    const created = await tasks.create(ALICE, NEW_TASK);
    const lookup = vi
      .spyOn(TaskRepository.prototype, "findAssigneeGroupById")
      .mockResolvedValueOnce({ id: "team", memberCount: 1, name: "Team" })
      .mockResolvedValueOnce(null);

    await tasks.update(ALICE, created.id, {
      assigneeGroupId: "team",
      assigneeId: null,
      description: "",
      dueAt: null,
      milestoneId: null,
      parentId: null,
      priority: created.priority,
      reporterId: "alice",
      startAt: null,
      statusId: created.statusId,
      title: created.title,
    });
    lookup.mockRestore();

    const changes = (await tasks.getHistory(ALICE, created.id)).filter(
      (entry) => entry.action === "assignee_changed",
    );
    expect(changes.map((entry) => entry.newValue)).toEqual([null]);
  });

  it("keeps editing a ticket whose group has lost its members", async () => {
    const { tasks, database } = await setup();
    const created = await tasks.create(ALICE, {
      ...NEW_TASK,
      assigneeGroupId: "team",
    });
    await database.execute("DELETE FROM user_group_members;");

    const renamed = await tasks.update(ALICE, created.id, {
      assigneeGroupId: "team",
      assigneeId: null,
      description: "",
      dueAt: null,
      milestoneId: null,
      parentId: null,
      priority: created.priority,
      reporterId: "alice",
      startAt: null,
      statusId: created.statusId,
      title: "Renamed",
    });

    expect(renamed.title).toBe("Renamed");
    expect(renamed.assigneeGroupId).toBe("team");
  });

  it("filters by person, group and by what is mine", async () => {
    const { tasks } = await setup();
    await tasks.create(ALICE, { ...NEW_TASK, title: "Alone" });
    await tasks.create(ALICE, {
      ...NEW_TASK,
      title: "Bobs",
      assigneeId: "bob",
    });
    await tasks.create(ALICE, {
      ...NEW_TASK,
      assigneeGroupId: "team",
      title: "Teams",
    });
    const titles = async (
      options: Parameters<TaskService["findAll"]>[1],
    ): Promise<string[]> =>
      (await tasks.findAll(ALICE, { ...options, orderBy: "updated_desc" }))
        .map((item) => item.title)
        .sort();

    expect(await titles({ assigneeId: "bob" })).toEqual(["Bobs"]);
    expect(await titles({ assigneeGroupId: "team" })).toEqual(["Teams"]);
    expect(await titles({ assignedToUserId: "bob" })).toEqual([
      "Bobs",
      "Teams",
    ]);
    expect(await titles({ assignedToUserId: "alice" })).toEqual([]);
    expect(await titles({})).toEqual(["Alone", "Bobs", "Teams"]);
    expect(await tasks.findMemberGroupIds(BOB)).toEqual(["team"]);
    expect(await tasks.findMemberGroupIds(ALICE)).toEqual([]);
    expect(
      (await tasks.findAssigneeGroups(ALICE)).map((group) => [
        group.name,
        group.memberCount,
      ]),
    ).toEqual([
      ["Ghosts", 0],
      ["Team", 2],
    ]);
  });

  it("offers per project only groups with a member who can work in it", async () => {
    const { database, tasks } = await setup();
    await database.execute(`
      INSERT INTO user_groups (id, name)
      VALUES ('outside', 'Outside');
      INSERT INTO user_group_members (group_id, user_id)
      VALUES ('outside', 'outsider');
    `);
    const assignees = await tasks.findAssigneesByProjects(["p1", "p2"]);

    // Team has bob, who works in both projects; Outside has only an account
    // without project access; Ghosts has nobody.
    await expect(
      tasks.findAssigneeGroupIdsByProject(ALICE, Object.fromEntries(assignees)),
    ).resolves.toEqual({ p1: ["team"], p2: ["team"] });
    await expect(
      tasks.findAssigneeGroupIdsByProject(ALICE, { p3: [] }),
    ).resolves.toEqual({ p3: [] });
  });

  it("counts group tickets as assigned to every member", async () => {
    const { tasks } = await setup();
    await tasks.create(ALICE, { ...NEW_TASK, assigneeGroupId: "team" });
    const scope = {
      todayDate: "2999-01-01",
      userId: "bob",
      weekAgoStart: "2000-01-01",
      yesterdayDate: "2998-12-31",
    };

    expect(
      (await tasks.countWorkItemsOverview(BOB, ["p1"], scope)).assigned,
    ).toBe(1);
    expect(
      (
        await tasks.countWorkItemsOverview(ALICE, ["p1"], {
          ...scope,
          userId: "alice",
        })
      ).assigned,
    ).toBe(0);
  });

  it("keeps the group when a ticket moves to another project", async () => {
    const { tasks } = await setup();
    const created = await tasks.create(ALICE, {
      ...NEW_TASK,
      assigneeGroupId: "team",
    });

    const moved = await tasks.moveToProject(ALICE, created.id, "p2");

    expect(moved.projectId).toBe("p2");
    expect(moved.assigneeGroupId).toBe("team");
  });
});
