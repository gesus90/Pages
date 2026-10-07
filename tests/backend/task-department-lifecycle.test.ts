import { describe, expect, it } from "vitest";

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

const MEMBER = createUser({ id: "member" });
const MANAGER = createUser({ id: "manager" });
const GLOBAL = createUser({ id: "global" });
const ADMIN = createUser({ id: "admin" });
const READER = createUser({ id: "reader" });

const MEMBER_ROLE = createRole({
  id: "member-role",
  name: "Member",
  permissions: [CAPABILITY.WRITE],
});

const ACCOUNTS: readonly AccountAccess[] = [
  createAccess({
    userId: "member",
    role: MEMBER_ROLE,
    departments: ["frontend"],
    managedDepartments: [],
  }),
  createAccess({
    userId: "manager",
    departments: ["frontend"],
    managedDepartments: ["backend"],
  }),
  createAccess({
    userId: "global",
    departments: ["frontend"],
    managedDepartments: [],
    allDepartments: true,
  }),
  createAccess({
    userId: "admin",
    departments: [],
    isAdmin: true,
    mode: "admin",
  }),
  createAccess({
    userId: "reader",
    role: createRole({ id: "reader-role", name: "Reader", permissions: [] }),
    departments: ["frontend"],
    managedDepartments: [],
  }),
];

describe("ticket departments, archive and permanent deletion", () => {
  const getDatabase = useMigratedDatabase();

  async function setup() {
    const database = getDatabase();
    const authorization = new AuthorizationRepository(database);
    await database.execute(`
      INSERT INTO departments (id, name) VALUES ('frontend', 'Frontend'), ('backend', 'Backend'), ('support', 'Support');
    `);
    for (const account of ACCOUNTS) {
      await authorization.users().insert({
        id: account.userId,
        username: account.userId,
        displayName: account.userId,
        passwordHash: "hash",
        role: "employee",
      });
      await authorization.saveRole(account.role ?? MEMBER_ROLE);
      await authorization.saveAccount(account);
    }
    await database.execute(`
      INSERT INTO projects (id, name, owner_id) VALUES ('p1', 'Shared project', 'member');
      INSERT INTO project_departments (project_id, department_id) VALUES ('p1', 'frontend'), ('p1', 'backend');
      INSERT INTO work_items (id, project_id, key, number, type, parent_id, title, status_id, created_by, department_id, sort_order)
      VALUES ('epic', 'p1', 'PAGE-1', 1, 'epic', NULL, 'Epic', 'status-todo', 'member', NULL, 1),
          ('front', 'p1', 'PAGE-2', 2, 'task', 'epic', 'Frontend task', 'status-todo', 'member', 'frontend', 2),
          ('open', 'p1', 'PAGE-3', 3, 'task', 'epic', 'Public task', 'status-todo', 'member', NULL, 3),
          ('hidden', 'p1', 'PAGE-4', 4, 'subtask', 'front', 'Backend subtask', 'status-todo', 'member', 'backend', 4),
          ('leaf', 'p1', 'PAGE-5', 5, 'task', NULL, 'Leaf', 'status-todo', 'member', NULL, 5);
      INSERT INTO work_item_history (id, work_item_id, user_id, action)
      VALUES ('old', 'hidden', 'member', 'created');
    `);
    const cache = new ServerCache();
    const repository = new TaskRepository(database);
    const projects = new ProjectRepository(database);
    const accessFor = new Map(
      ACCOUNTS.map((account) => [account.userId, account] as const),
    );
    const permissions = new PermissionService(async (userId) => {
      const account = accessFor.get(userId);
      if (!account) throw new Error("unknown account");
      return account;
    });
    return {
      database,
      repository,
      tasks: new TaskService(
        repository,
        new ProjectService(projects, permissions, null, cache),
        permissions,
        cache,
      ),
    };
  }

  function departmentsOf(
    choices: Awaited<ReturnType<TaskService["departmentChoices"]>>,
  ): string[] {
    return choices.available.map((department) => department.id);
  }

  it("offers own departments to members and wider scopes to managers", async () => {
    const { tasks } = await setup();

    expect(departmentsOf(await tasks.departmentChoices(MEMBER))).toEqual([
      "frontend",
    ]);
    expect(departmentsOf(await tasks.departmentChoices(MANAGER))).toEqual([
      "backend",
      "frontend",
    ]);
    expect(departmentsOf(await tasks.departmentChoices(GLOBAL))).toEqual([
      "backend",
      "frontend",
      "support",
    ]);
    expect(departmentsOf(await tasks.departmentChoices(ADMIN))).toEqual([
      "backend",
      "frontend",
      "support",
    ]);
  });

  it("rejects department choices for deactivated accounts", async () => {
    const { tasks, database } = await setup();

    await database.execute(
      "UPDATE users SET is_active = 0 WHERE id = 'member';",
    );

    await expect(tasks.departmentChoices(MEMBER)).rejects.toThrow(
      "not allowed",
    );
  });

  it("reports write and delete hints from current facts", async () => {
    const { tasks } = await setup();

    expect(await tasks.actionPermissions(MEMBER)).toEqual({
      canDelete: false,
      canWrite: true,
    });
    expect(await tasks.actionPermissions(READER)).toEqual({
      canDelete: false,
      canWrite: false,
    });
    expect(await tasks.actionPermissions(ADMIN)).toEqual({
      canDelete: true,
      canWrite: true,
    });
  });

  it("creates tickets with an optional, validated department", async () => {
    const { tasks } = await setup();
    const base = {
      projectId: "p1",
      statusId: "status-todo",
      title: "New",
      type: "task",
    } as const;

    const without = await tasks.create(MEMBER, {
      ...base,
      departmentId: "  ",
      skipGitHubSync: true,
    });
    expect(without.departmentId).toBeNull();

    const own = await tasks.create(MEMBER, {
      ...base,
      departmentId: "frontend",
      skipGitHubSync: true,
    });
    expect(own.departmentId).toBe("frontend");

    await expect(
      tasks.create(MEMBER, {
        ...base,
        departmentId: "ghost",
        skipGitHubSync: true,
      }),
    ).rejects.toThrow("Selected department does not exist.");
    await expect(
      tasks.create(MEMBER, {
        ...base,
        departmentId: "backend",
        skipGitHubSync: true,
      }),
    ).rejects.toThrow("not allowed");

    // A manager may file into a department outside their own, which they then no longer see.
    const foreign = await tasks.create(MANAGER, {
      ...base,
      departmentId: "backend",
      skipGitHubSync: true,
    });
    expect(foreign.departmentId).toBe("backend");
    await expect(tasks.getById(MANAGER, foreign.id)).rejects.toThrow(
      "does not exist",
    );

    await expect(
      tasks.create(READER, { ...base, skipGitHubSync: true }),
    ).rejects.toThrow("not allowed");
  });

  it("reassigns, clears and records departments apart from content edits", async () => {
    const { tasks, repository } = await setup();

    await tasks.setDepartment(MEMBER, "open", "frontend");
    expect(await tasks.getById(MEMBER, "open")).toMatchObject({
      departmentId: "frontend",
    });
    expect(
      (await repository.findHistoryByWorkItemId("open")).find(
        (entry) => entry.action === "department_changed",
      ),
    ).toMatchObject({ oldValue: null, newValue: "Frontend" });

    await tasks.setDepartment(MEMBER, "open", "frontend");
    expect(
      (await repository.findHistoryByWorkItemId("open")).filter(
        (entry) => entry.action === "department_changed",
      ),
    ).toHaveLength(1);

    await tasks.setDepartment(MEMBER, "open", "");
    expect(await tasks.getById(MEMBER, "open")).toMatchObject({
      departmentId: null,
    });
    expect(
      (await repository.findHistoryByWorkItemId("open")).some(
        (entry) => entry.oldValue === "Frontend" && entry.newValue === null,
      ),
    ).toBe(true);

    await expect(
      tasks.setDepartment(MEMBER, "open", "backend"),
    ).rejects.toThrow("not allowed");
    await expect(tasks.setDepartment(MEMBER, "open", "ghost")).rejects.toThrow(
      "Selected department does not exist.",
    );
    await expect(
      tasks.setDepartment(READER, "open", "frontend"),
    ).rejects.toThrow("not allowed");
    await expect(tasks.setDepartment(MEMBER, "hidden", null)).rejects.toThrow(
      "does not exist",
    );
  });

  it("archives and restores a subtree with the same write rule", async () => {
    const { tasks, repository } = await setup();

    await tasks.archive(MEMBER, "leaf");
    expect(await repository.findSubtreeIds("leaf")).toEqual(["leaf"]);
    await expect(tasks.getById(MEMBER, "leaf")).resolves.toMatchObject({
      archivedAt: expect.any(String),
    });
    await expect(tasks.restore(READER, "leaf")).rejects.toThrow("not allowed");
    await expect(tasks.archive(READER, "leaf")).rejects.toThrow("not allowed");
    await tasks.restore(MEMBER, "leaf");
    await expect(tasks.getById(MEMBER, "leaf")).resolves.toMatchObject({
      archivedAt: null,
    });

    await tasks.archive(ADMIN, "epic");
    const archived = await tasks.findAll(ADMIN, { archived: "archived" });
    expect(archived.map((item) => item.id).sort()).toEqual([
      "epic",
      "front",
      "hidden",
      "open",
    ]);
    expect(
      (await repository.findHistoryByWorkItemId("hidden")).filter(
        (entry) => entry.action === "archived",
      ),
    ).toHaveLength(1);

    await tasks.restore(ADMIN, "epic");
    expect(await tasks.findAll(ADMIN, { archived: "archived" })).toEqual([]);
  });

  it("refuses to change a subtree that contains tickets the actor cannot see", async () => {
    const { tasks } = await setup();

    await expect(tasks.archive(MEMBER, "epic")).rejects.toThrow(
      "not visible to you",
    );
    await expect(tasks.restore(MEMBER, "front")).rejects.toThrow(
      "not visible to you",
    );
    await expect(tasks.archive(MEMBER, "missing")).rejects.toThrow(
      "does not exist",
    );
  });

  it("deletes a subtree permanently in administrator mode only", async () => {
    const { tasks, repository, database } = await setup();

    await expect(tasks.deletePermanently(MEMBER, "leaf")).rejects.toThrow(
      "not allowed",
    );
    await expect(tasks.deletePermanently(ADMIN, "missing")).rejects.toThrow(
      "does not exist",
    );

    await tasks.deletePermanently(ADMIN, "epic");
    expect(await repository.findSubtreeIds("epic")).toEqual([]);
    expect(
      (await tasks.findAll(ADMIN, { archived: "all" })).map((item) => item.id),
    ).toEqual(["leaf"]);
    const history = await database.query(
      "SELECT COUNT(*) FROM work_item_history WHERE work_item_id = 'hidden';",
    );
    expect(Number(history[0]?.[0])).toBe(0);
  });

  it("lets every writer label, check and link a restored ticket", async () => {
    const { tasks } = await setup();
    const label = await tasks.createLabel(MEMBER, {
      color: "#3b82f6",
      name: "Shared",
    });

    await tasks.archive(MEMBER, "leaf");
    await tasks.restore(MEMBER, "leaf");
    await tasks.assignLabel(MEMBER, "leaf", label.id);
    await tasks.addChecklistItem(MEMBER, "leaf", "Check");
    await expect(tasks.assignLabel(READER, "leaf", label.id)).rejects.toThrow(
      "not allowed",
    );
    await expect(
      tasks.createLabel(READER, { color: "#3b82f6", name: "Nope" }),
    ).rejects.toThrow("not allowed");
  });

  it("keeps the department when a ticket moves between projects", async () => {
    const { tasks, database } = await setup();

    await database.execute(`
      INSERT INTO projects (id, name, owner_id) VALUES ('p2', 'Second', 'member');
      INSERT INTO project_departments (project_id, department_id) VALUES ('p2', 'frontend');
    `);
    await tasks.moveToProject(MEMBER, "leaf", "p2");
    await tasks.setDepartment(MEMBER, "leaf", "frontend");
    await tasks.moveToProject(MEMBER, "leaf", "p1");
    expect(await tasks.getById(MEMBER, "leaf")).toMatchObject({
      departmentId: "frontend",
      projectId: "p1",
    });
  });
});
