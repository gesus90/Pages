import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PermissionService } from "@/backend/auth/PermissionService";
import { ServerCache } from "@/backend/cache/ServerCache";
import { Database, IN_MEMORY_DATABASE_PATH } from "@/backend/database/Database";
import { DATABASE_MIGRATIONS } from "@/backend/database/Migrations";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { ProjectService } from "@/backend/service/ProjectService";
import { TaskService } from "@/backend/service/TaskService";
import { createAccess, createRole } from "../helpers/authorization";
import { createUser } from "../helpers/factories";
import { useMigratedDatabase } from "../helpers/test-database";

const ADMIN = createUser({ id: "admin" });
const ADMIN_ACCESS = createAccess({
  departments: [],
  isAdmin: true,
  mode: "admin",
  userId: "admin",
});

describe("migration 017 ticket number counter", () => {
  let database: Database;

  beforeEach(async () => {
    database = await Database.create(IN_MEMORY_DATABASE_PATH);
    await database.migrate(
      DATABASE_MIGRATIONS.filter(
        (migration) => migration.name < "017_ticket_number_counter.sql",
      ),
    );
  });

  afterEach(async () => {
    await database.close();
  });

  it("starts every project at its highest number in use", async () => {
    await database.execute(`
      INSERT INTO project_keys (project_id, key)
      VALUES ('with-gaps', 'GAP'), ('empty', 'NEW');
      INSERT INTO work_items (id, project_id, key, number, type, title, status_id, created_by)
      VALUES ('w1', 'with-gaps', 'GAP-1', 1, 'task', 'One', 'status-todo', 'u'),
          ('w5', 'with-gaps', 'GAP-5', 5, 'task', 'Five', 'status-todo', 'u');
    `);

    await database.migrate(DATABASE_MIGRATIONS);

    const rows = await database.query(
      "SELECT project_id, last_number FROM project_keys ORDER BY project_id;",
    );

    expect(rows.map((row) => [row[0], Number(row[1])])).toEqual([
      ["empty", 0],
      ["with-gaps", 5],
    ]);
  });
});

describe("ticket keys are never handed out twice", () => {
  const getDatabase = useMigratedDatabase();

  async function setup() {
    const database = getDatabase();
    const authorization = new AuthorizationRepository(database);

    await authorization.users().insert({
      displayName: "admin",
      id: "admin",
      passwordHash: "hash",
      role: "admin",
      username: "admin",
    });
    await authorization.saveRole(createRole());
    await authorization.saveAccount(ADMIN_ACCESS);
    await database.execute(`
      INSERT INTO projects (id, name, owner_id)
      VALUES ('alpha', 'Alpha', 'admin'), ('beta', 'Beta', 'admin');
    `);

    const cache = new ServerCache();
    const repository = new TaskRepository(database);
    const permissions = new PermissionService(async () => ADMIN_ACCESS);

    return {
      database,
      repository,
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

  function createTicket(
    tasks: TaskService,
    projectId: string,
  ): Promise<{ id: string; key: string }> {
    return tasks.create(ADMIN, {
      projectId,
      skipGitHubSync: true,
      statusId: "status-todo",
      title: "Ticket",
      type: "task",
    });
  }

  it("keeps the number of a permanently deleted ticket out of circulation", async () => {
    const { tasks } = await setup();
    const first = await createTicket(tasks, "alpha");
    const second = await createTicket(tasks, "alpha");

    expect([first.key, second.key]).toEqual(["ALPH-1", "ALPH-2"]);

    await tasks.deletePermanently(ADMIN, second.id);
    const third = await createTicket(tasks, "alpha");

    expect(third.key).toBe("ALPH-3");

    await tasks.deletePermanently(ADMIN, first.id);
    await tasks.deletePermanently(ADMIN, third.id);

    await expect(createTicket(tasks, "alpha")).resolves.toMatchObject({
      key: "ALPH-4",
    });
  });

  it("does not give the old number of a moved ticket to the next one", async () => {
    const { tasks } = await setup();
    const ticket = await createTicket(tasks, "alpha");

    const moved = await tasks.moveToProject(ADMIN, ticket.id, "beta");

    expect(moved.key).toBe("BETA-1");
    await expect(createTicket(tasks, "alpha")).resolves.toMatchObject({
      key: "ALPH-2",
    });
    await expect(createTicket(tasks, "beta")).resolves.toMatchObject({
      key: "BETA-2",
    });
  });

  it("reserves one number per moved ticket of a subtree", async () => {
    const { tasks, repository } = await setup();
    const parent = await createTicket(tasks, "alpha");

    await tasks.create(ADMIN, {
      parentId: parent.id,
      projectId: "alpha",
      skipGitHubSync: true,
      statusId: "status-todo",
      title: "Child",
      type: "subtask",
    });
    await tasks.moveToProject(ADMIN, parent.id, "beta");

    await expect(repository.reserveNumbers("beta", 1)).resolves.toBe(3);
  });

  it("continues behind tickets that carry numbers above the counter", async () => {
    const { database, repository } = await setup();

    await repository.findOrCreateProjectKey("alpha", "ALPH");
    await database.execute(`
      INSERT INTO work_items (id, project_id, key, number, type, title, status_id, created_by)
      VALUES ('w7', 'alpha', 'ALPH-7', 7, 'task', 'Seven', 'status-todo', 'admin');
    `);

    await expect(repository.reserveNumbers("alpha", 2)).resolves.toBe(8);
    await expect(repository.reserveNumbers("alpha", 1)).resolves.toBe(10);
  });

  it("refuses to reserve numbers for a project without a key", async () => {
    const { repository } = await setup();

    await expect(repository.reserveNumbers("alpha", 1)).rejects.toThrow(
      'Project "alpha" has no ticket key.',
    );
  });
});
