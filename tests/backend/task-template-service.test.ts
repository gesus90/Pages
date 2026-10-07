import { describe, expect, it } from "vitest";

import { PermissionService } from "@/backend/auth/PermissionService";
import { ServerCache } from "@/backend/cache/ServerCache";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { WorkItemTemplateRepository } from "@/backend/database/repositories/task/WorkItemTemplateRepository";
import { ProjectService } from "@/backend/service/ProjectService";
import { TaskService } from "@/backend/service/TaskService";
import { TaskTemplateService } from "@/backend/service/TaskTemplateService";
import { CAPABILITY } from "@/definition/Authorization";
import { TEMPLATE_SCOPE } from "@/definition/WorkItemTemplate";
import { createAccess, createRole } from "../helpers/authorization";
import { createUser } from "../helpers/factories";
import { useMigratedDatabase } from "../helpers/test-database";

import type { AccountAccess } from "@/definition/Authorization";
import type { CreateWorkItemInput } from "@/backend/service/TaskService";
import type { TemplateDetailsInput } from "@/definition/WorkItemTemplate";

const WRITER_ROLE = createRole({
  departmentBound: false,
  id: "writer",
  name: "Writer",
  permissions: [CAPABILITY.WRITE],
});
const READER_ROLE = createRole({
  departmentBound: false,
  id: "reader",
  name: "Reader",
  permissions: [],
});
const ALICE = createUser({ id: "alice" });
const BOB = createUser({ id: "bob" });
const CAROL = createUser({ id: "carol" });
const READER = createUser({ id: "reader" });
const ADMIN = createUser({ id: "admin" });

const ACCOUNTS: readonly AccountAccess[] = [
  createAccess({
    departments: ["frontend"],
    managedDepartments: [],
    role: WRITER_ROLE,
    userId: "alice",
  }),
  createAccess({
    departments: ["frontend"],
    managedDepartments: [],
    role: WRITER_ROLE,
    userId: "bob",
  }),
  createAccess({
    departments: ["support"],
    managedDepartments: [],
    role: WRITER_ROLE,
    userId: "carol",
  }),
  createAccess({
    departments: [],
    managedDepartments: [],
    role: READER_ROLE,
    userId: "reader",
  }),
  createAccess({
    departments: [],
    isAdmin: true,
    managedDepartments: [],
    mode: "admin",
    role: null,
    userId: "admin",
  }),
];

const PRIVATE: TemplateDetailsInput = {
  departmentIds: [],
  name: "  Bug report  ",
  projectIds: [],
  scope: TEMPLATE_SCOPE.PRIVATE,
};

const NEW_TASK: CreateWorkItemInput = {
  projectId: "p1",
  statusId: "status-todo",
  title: "Bug: ",
  type: "task",
};

describe("ticket templates", () => {
  const getDatabase = useMigratedDatabase();

  async function setup() {
    const database = getDatabase();
    const authorization = new AuthorizationRepository(database);

    await database.execute(`
      INSERT INTO departments (id, name)
      VALUES ('frontend', 'Frontend'), ('support', 'Support');
    `);
    await authorization.saveRole(WRITER_ROLE);
    await authorization.saveRole(READER_ROLE);
    for (const account of ACCOUNTS) {
      await authorization.users().insert({
        displayName: account.userId,
        id: account.userId,
        passwordHash: "hash",
        role: "employee",
        username: account.userId,
      });
      await authorization.saveAccount(account);
    }
    await database.execute(`
      INSERT INTO projects (id, name, owner_id)
      VALUES ('p1', 'First', 'alice'), ('p2', 'Second', 'alice');
      INSERT INTO project_departments (project_id, department_id)
      VALUES ('p1', 'frontend'), ('p2', 'frontend');
      INSERT INTO labels (id, name)
      VALUES ('bug', 'Bug'), ('ci', 'CI');
    `);
    const cache = new ServerCache();
    const permissions = new PermissionService(async (userId) => {
      const account = ACCOUNTS.find((entry) => entry.userId === userId);

      if (!account) {
        throw new Error("unknown account");
      }

      return account;
    });
    const projects = new ProjectService(
      new ProjectRepository(database),
      permissions,
      null,
      cache,
    );
    const tasks = new TaskService(
      new TaskRepository(database),
      projects,
      permissions,
      cache,
    );

    return {
      tasks,
      templates: new TaskTemplateService(
        new WorkItemTemplateRepository(database),
        tasks,
        projects,
        permissions,
      ),
    };
  }

  async function setupWithSourceTicket() {
    const context = await setup();
    const ticket = await context.tasks.create(ALICE, {
      ...NEW_TASK,
      description: "Steps",
      priority: "urgent",
      title: "Crash on save",
    });

    await context.tasks.assignLabel(ALICE, ticket.id, "bug");
    await context.tasks.addChecklistItem(ALICE, ticket.id, "Reproduce");
    await context.tasks.addChecklistItem(ALICE, ticket.id, "Fix");

    return { ...context, ticket };
  }

  it("saves the content of a ticket and nothing personal", async () => {
    const { templates, ticket } = await setupWithSourceTicket();

    await templates.saveFromTicket(ALICE, ticket.id, PRIVATE);

    const [template] = await templates.findVisible(ALICE);

    expect(template).toMatchObject({
      canManage: true,
      checklist: ["Reproduce", "Fix"],
      description: "Steps",
      labelIds: ["bug"],
      name: "Bug report",
      ownerId: "alice",
      priority: "urgent",
      scope: TEMPLATE_SCOPE.PRIVATE,
      title: "Crash on save",
      type: "task",
    });
  });

  it("saves a ticket without labels or checklist", async () => {
    const { templates, tasks } = await setup();
    const bare = await tasks.create(ALICE, NEW_TASK);

    await templates.saveFromTicket(ALICE, bare.id, PRIVATE);

    expect((await templates.findVisible(ALICE))[0]).toMatchObject({
      checklist: [],
      labelIds: [],
    });
  });

  it("keeps a private template to its owner and the administrator mode", async () => {
    const { templates, ticket } = await setupWithSourceTicket();

    await templates.saveFromTicket(ALICE, ticket.id, PRIVATE);

    expect(await templates.findVisible(BOB)).toEqual([]);
    expect(await templates.findVisible(ADMIN)).toHaveLength(1);
    expect((await templates.findVisible(ADMIN))[0]?.canManage).toBe(true);
  });

  it("shares with all, departments and projects", async () => {
    const { templates, ticket } = await setupWithSourceTicket();

    await templates.saveFromTicket(ALICE, ticket.id, {
      ...PRIVATE,
      name: "Everyone",
      scope: TEMPLATE_SCOPE.ALL,
    });
    await templates.saveFromTicket(ALICE, ticket.id, {
      ...PRIVATE,
      departmentIds: ["frontend", "frontend"],
      name: "Frontend",
      projectIds: ["p1"],
      scope: TEMPLATE_SCOPE.DEPARTMENTS,
    });
    await templates.saveFromTicket(ALICE, ticket.id, {
      ...PRIVATE,
      name: "Project",
      projectIds: ["p1"],
      scope: TEMPLATE_SCOPE.PROJECTS,
    });

    const names = async (user: typeof ALICE): Promise<string[]> =>
      (await templates.findVisible(user)).map((template) => template.name);

    expect(await names(BOB)).toEqual(["Everyone", "Frontend", "Project"]);
    expect(await names(CAROL)).toEqual(["Everyone", "Project"]);
    expect((await templates.findVisible(BOB))[0]?.canManage).toBe(false);

    const frontend = (await templates.findVisible(ALICE)).find(
      (template) => template.name === "Frontend",
    );

    expect(frontend?.departmentIds).toEqual(["frontend"]);
    expect(frontend?.projectIds).toEqual([]);
  });

  it("refuses shares the actor may not make", async () => {
    const { templates, ticket } = await setupWithSourceTicket();

    await expect(
      templates.saveFromTicket(ALICE, ticket.id, {
        ...PRIVATE,
        departmentIds: ["support"],
        scope: TEMPLATE_SCOPE.DEPARTMENTS,
      }),
    ).rejects.toThrow("not allowed");
    await expect(
      templates.saveFromTicket(ALICE, ticket.id, {
        ...PRIVATE,
        departmentIds: ["nowhere"],
        scope: TEMPLATE_SCOPE.DEPARTMENTS,
      }),
    ).rejects.toThrow("does not exist");
    await expect(
      templates.saveFromTicket(ALICE, ticket.id, {
        ...PRIVATE,
        scope: TEMPLATE_SCOPE.PROJECTS,
      }),
    ).rejects.toThrow("at least one");
    await expect(
      templates.saveFromTicket(ALICE, ticket.id, {
        ...PRIVATE,
        projectIds: ["unknown"],
        scope: TEMPLATE_SCOPE.PROJECTS,
      }),
    ).rejects.toThrow("not allowed");
    await expect(
      templates.saveFromTicket(ALICE, ticket.id, { ...PRIVATE, name: " " }),
    ).rejects.toThrow("between 1 and 80");
    await expect(
      templates.saveFromTicket(ALICE, ticket.id, {
        ...PRIVATE,
        name: "x".repeat(81),
      }),
    ).rejects.toThrow("between 1 and 80");
  });

  it("requires the write capability and ticket access to save", async () => {
    const { templates, ticket } = await setupWithSourceTicket();

    await expect(
      templates.saveFromTicket(READER, ticket.id, PRIVATE),
    ).rejects.toThrow("not allowed");
    await expect(
      templates.saveFromTicket(ALICE, "missing", PRIVATE),
    ).rejects.toThrow("does not exist");
  });

  it("lets only owner and administrator mode reshare and delete", async () => {
    const { templates, ticket } = await setupWithSourceTicket();

    await templates.saveFromTicket(ALICE, ticket.id, {
      ...PRIVATE,
      scope: TEMPLATE_SCOPE.ALL,
    });

    const [template] = await templates.findVisible(ALICE);
    const id = template?.id ?? "";

    await expect(templates.update(BOB, id, PRIVATE)).rejects.toThrow(
      "not allowed",
    );
    await expect(templates.delete(BOB, id)).rejects.toThrow("not allowed");
    await expect(templates.update(READER, id, PRIVATE)).rejects.toThrow(
      "not allowed",
    );

    await templates.update(ALICE, id, { ...PRIVATE, name: "Renamed" });
    await templates.update(ADMIN, id, {
      ...PRIVATE,
      name: "By admin",
      scope: TEMPLATE_SCOPE.ALL,
    });

    expect((await templates.findVisible(BOB))[0]).toMatchObject({
      name: "By admin",
      ownerId: "alice",
      title: "Crash on save",
    });

    await templates.delete(ADMIN, id);

    expect(await templates.findVisible(ALICE)).toEqual([]);
  });

  it("hides unseen and missing templates alike", async () => {
    const { templates, ticket } = await setupWithSourceTicket();

    await templates.saveFromTicket(ALICE, ticket.id, PRIVATE);

    const id = (await templates.findVisible(ALICE))[0]?.id ?? "";

    await expect(templates.update(BOB, id, PRIVATE)).rejects.toThrow(
      "does not exist",
    );
    await expect(templates.delete(BOB, id)).rejects.toThrow("does not exist");
    await expect(templates.delete(ALICE, "missing")).rejects.toThrow(
      "does not exist",
    );
  });

  it("creates a ticket with the labels and checklist of the template", async () => {
    const { tasks, templates, ticket } = await setupWithSourceTicket();

    await templates.saveFromTicket(ALICE, ticket.id, {
      ...PRIVATE,
      scope: TEMPLATE_SCOPE.ALL,
    });

    const id = (await templates.findVisible(BOB))[0]?.id ?? "";
    const created = await templates.createFromTemplate(BOB, id, {
      ...NEW_TASK,
      title: "Another crash",
    });
    const labels = await tasks.findLabelsForWorkItems([created.id]);

    expect(created.title).toBe("Another crash");
    expect(labels.get(created.id)?.map((label) => label.id)).toEqual(["bug"]);
    expect(
      (await tasks.findChecklistItems(BOB, created.id)).map(
        (item) => item.title,
      ),
    ).toEqual(["Reproduce", "Fix"]);
  });

  it("does not create a ticket from a template the actor cannot see", async () => {
    const { templates, ticket } = await setupWithSourceTicket();

    await templates.saveFromTicket(ALICE, ticket.id, PRIVATE);

    const id = (await templates.findVisible(ALICE))[0]?.id ?? "";

    await expect(
      templates.createFromTemplate(BOB, id, NEW_TASK),
    ).rejects.toThrow("does not exist");
  });
});
