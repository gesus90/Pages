import { describe, expect, it, vi } from "vitest";

import { PermissionService } from "@/backend/auth/PermissionService";
import { ServerCache } from "@/backend/cache/ServerCache";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { ProjectService } from "@/backend/service/ProjectService";
import { TaskAccessGuard } from "@/backend/service/task/TaskAccessGuard";
import { TaskService } from "@/backend/service/TaskService";
import { WorkItemReferenceValidator } from "@/backend/service/task/WorkItemReferenceValidator";
import { CAPABILITY } from "@/definition/Authorization";
import { createAccess, createRole } from "../helpers/authorization";
import { createUser } from "../helpers/factories";
import { useMigratedDatabase } from "../helpers/test-database";

import type { UpdateWorkItemInput } from "@/backend/service/TaskService";
import type { WorkItemDetail } from "@/definition/Task";

const ACTOR = createUser({ id: "actor" });
const OTHER = createUser({ id: "other" });

function updateInput(item: WorkItemDetail): UpdateWorkItemInput {
  return {
    title: item.title,
    description: item.description,
    statusId: item.statusId,
    priority: item.priority,
    assigneeId: item.assigneeId,
    reporterId: item.createdBy,
    parentId: item.parentId,
    milestoneId: item.milestoneId,
    dueAt: item.dueAt,
    startAt: item.startAt,
  };
}

describe("current account ticket visibility through services", () => {
  const getDatabase = useMigratedDatabase();

  async function setup() {
    const database = getDatabase();
    const authorization = new AuthorizationRepository(database);
    for (const actor of [ACTOR, OTHER]) {
      await authorization.users().insert({
        id: actor.id,
        username: actor.id,
        displayName: actor.id,
        passwordHash: "hash",
        role: "employee",
      });
      await authorization.saveRole(createRole({ name: "Scoped visibility" }));
      await authorization.saveAccount(
        createAccess({
          userId: actor.id,
          departments: actor.id === "actor" ? ["frontend"] : ["backend"],
        }),
      );
    }
    await database.execute(`
      UPDATE users SET role = 'manager';
      INSERT INTO departments (id, name) VALUES ('frontend', 'Frontend'), ('backend', 'Backend');
      INSERT INTO projects (id, name, owner_id) VALUES ('p1', 'Shared project', 'actor'), ('p2', 'Other project', 'actor');
      INSERT INTO project_departments (project_id, department_id) VALUES ('p1', 'frontend'), ('p1', 'backend'), ('p2', 'backend');
      INSERT INTO workflow_statuses (id, project_id, key, name, position, is_done) VALUES ('local', 'p1', 'local', 'Shared status', 10, 0), ('foreign-status', 'p2', 'foreign', 'Hidden status', 10, 0);
      INSERT INTO work_items (id, project_id, key, number, type, parent_id, title, status_id, created_by, department_id, sort_order, due_at)
      VALUES ('root', 'p1', 'PAGE-1', 1, 'epic', NULL, 'Public root', 'status-todo', 'actor', NULL, 1, NULL),
          ('hidden', 'p1', 'PAGE-2', 2, 'epic', NULL, 'Backend parent', 'status-todo', 'actor', 'backend', 0, NULL),
          ('child', 'p1', 'PAGE-3', 3, 'task', 'hidden', 'Public child', 'status-todo', 'actor', NULL, 2, '2026-01-01'),
          ('front', 'p1', 'PAGE-4', 4, 'task', 'root', 'Frontend task', 'status-done', 'actor', 'frontend', 3, NULL),
          ('back', 'p1', 'PAGE-5', 5, 'task', 'root', 'Backend task', 'status-todo', 'actor', 'backend', 4, NULL),
          ('foreign', 'p2', 'OTHER-1', 1, 'task', NULL, 'Other public task', 'status-todo', 'actor', NULL, -1, NULL);
      INSERT INTO work_item_history (id, work_item_id, user_id, action, field, old_value, new_value)
      VALUES ('parent', 'child', 'actor', 'parent_changed', 'parent', 'PAGE-2', 'PAGE-1'),
          ('parent-null', 'child', 'actor', 'parent_changed', 'parent', 'PAGE-1', NULL),
          ('parent-new-hidden', 'child', 'actor', 'parent_changed', 'parent', NULL, 'PAGE-2'),
          ('description', 'child', 'actor', 'description_changed', 'description', NULL, 'PAGE-2'),
          ('hidden-history', 'hidden', 'actor', 'created', NULL, NULL, NULL);
      INSERT INTO project_labels (id, project_id, name, color) VALUES ('label', 'p1', 'Shared label', '#3b82f6');
      INSERT INTO work_item_labels (work_item_id, label_id) VALUES ('front', 'label'), ('back', 'label');
      INSERT INTO work_item_links (id, work_item_id, linked_work_item_id, link_type)
      VALUES ('front-link', 'root', 'front', 'relates_to'), ('back-link', 'root', 'back', 'blocks'), ('foreign-link', 'root', 'foreign', 'blocks');
    `);
    const cache = new ServerCache();
    const projects = new ProjectService(
      new ProjectRepository(database),
      new PermissionService(),
      null,
      cache,
    );
    const repository = new TaskRepository(database);
    return {
      authorization,
      projects,
      repository,
      cache,
      tasks: new TaskService(
        repository,
        projects,
        new PermissionService(),
        cache,
      ),
    };
  }

  it("filters lists before limit, denies guessed IDs and keys, and redacts parent and progress data", async () => {
    const { tasks, projects, repository } = await setup();
    const guard = new TaskAccessGuard(
      repository,
      projects,
      new PermissionService(),
    );
    expect(await guard.resolveAccessibleProjectIds(ACTOR)).toEqual(["p1"]);
    expect(await repository.findParentReference("root")).toBeNull();
    expect(await repository.findParentReference("missing")).toBeNull();
    expect(
      (await tasks.findAll(ACTOR, { limit: 1 })).map((item) => item.id),
    ).toEqual(["root"]);
    expect(
      (await tasks.findAll(ACTOR, { visibility: { departmentIds: null } })).map(
        (item) => item.id,
      ),
    ).toEqual(["root", "child", "front"]);
    await expect(tasks.getById(ACTOR, "hidden")).rejects.toThrow(
      "does not exist",
    );
    await expect(tasks.getByKey(ACTOR, "PAGE-2")).rejects.toThrow(
      "does not exist",
    );
    await expect(tasks.getById(ACTOR, "foreign")).rejects.toThrow(
      "does not exist",
    );
    expect(await tasks.getById(ACTOR, "child")).toMatchObject({
      parentId: null,
      parentKey: null,
      parentTitle: null,
    });
    expect(await tasks.getById(ACTOR, "root")).toMatchObject({
      subtaskTotal: 1,
      subtaskCompleted: 1,
    });
    expect(
      (await tasks.findSubtasks(ACTOR, "root")).map((item) => item.id),
    ).toEqual(["front"]);
  });

  it("isolates warm caches by actor, live memberships and every query option", async () => {
    const { tasks, authorization } = await setup();
    expect((await tasks.findAll(ACTOR)).map((item) => item.id)).toEqual([
      "root",
      "child",
      "front",
    ]);
    expect((await tasks.findAll(OTHER)).map((item) => item.id)).toEqual([
      "foreign",
      "hidden",
      "root",
      "child",
      "back",
    ]);
    expect(
      (await tasks.findAll(ACTOR, { openOnly: true })).map((item) => item.id),
    ).toEqual(["root", "child"]);
    expect(
      (await tasks.findAll(ACTOR, { hasDueDate: true })).map((item) => item.id),
    ).toEqual(["child"]);
    await authorization.saveAccount(createAccess({ departments: ["backend"] }));
    expect((await tasks.findAll(ACTOR)).map((item) => item.id)).toEqual([
      "foreign",
      "hidden",
      "root",
      "child",
      "back",
    ]);
    await authorization.saveRole(
      createRole({ name: "Scoped visibility", departmentBound: false }),
    );
    await authorization.saveAccount(
      createAccess({
        departments: [],
        role: createRole({ departmentBound: false }),
        allProjects: true,
        allDepartments: true,
      }),
    );
    expect((await tasks.findAll(ACTOR)).map((item) => item.id)).toEqual([
      "foreign",
      "root",
      "child",
    ]);
    await authorization.saveAccount(
      createAccess({ departments: [], isAdmin: true, mode: "admin" }),
    );
    expect(await tasks.findAll(ACTOR)).toHaveLength(6);
    await authorization.saveRole(createRole({ name: "Scoped visibility" }));
    await authorization.saveAccount(createAccess({ departments: [] }));
    expect(await tasks.findAll(ACTOR)).toEqual([]);
    await getDatabase().execute(
      "UPDATE users SET is_active = 0 WHERE id = 'actor';",
    );
    await expect(tasks.findAll(ACTOR)).rejects.toThrow("not allowed");
  });

  it("scopes dashboard and label counters and project-local status catalogs", async () => {
    const { tasks } = await setup();
    expect(
      (await tasks.countWorkItemsByProject(ACTOR, ["p1", "p2"])).get("p1"),
    ).toMatchObject({ total: 3, done: 1 });
    expect(
      (await tasks.countWorkItemsByProject(OTHER, ["p1"])).get("p1"),
    ).toMatchObject({ total: 4, done: 0 });
    expect(
      await tasks.countWorkItemsOverview(ACTOR, ["p1", "p2"], {
        userId: "forged",
        todayDate: "2026-10-07",
        yesterdayDate: "2026-10-06",
        weekAgoStart: "2026-10-01",
      }),
    ).toMatchObject({ open: 2, overdue: 1 });
    expect((await tasks.countLabelUsage(ACTOR, "p1")).get("label")).toBe(1);
    expect(
      (await tasks.countLabelUsageByProjects(OTHER, ["p1"]))
        .get("p1")
        ?.get("label"),
    ).toBe(1);
    expect(
      (await tasks.findAllStatuses(ACTOR)).map((status) => status.id),
    ).toContain("local");
    expect(
      (await tasks.findAllStatuses(ACTOR)).map((status) => status.id),
    ).not.toContain("foreign-status");
    expect(
      (await tasks.findAllStatuses(OTHER)).map((status) => status.id),
    ).toContain("foreign-status");
  });

  it("redacts hidden system parent history but preserves arbitrary user text", async () => {
    const { tasks, repository } = await setup();
    const history = await tasks.getHistory(ACTOR, "child");
    expect(history.find((entry) => entry.id === "parent")).toMatchObject({
      oldValue: null,
      newValue: "PAGE-1",
    });
    expect(history.find((entry) => entry.id === "parent-null")).toMatchObject({
      oldValue: "PAGE-1",
      newValue: null,
    });
    expect(
      history.find((entry) => entry.id === "parent-new-hidden"),
    ).toMatchObject({ oldValue: null, newValue: null });
    expect(history.find((entry) => entry.id === "description")).toMatchObject({
      newValue: "PAGE-2",
    });
    expect(
      (await tasks.findHistoryByProject(ACTOR, "p1")).some(
        (entry) => entry.id === "hidden-history",
      ),
    ).toBe(false);
    expect(
      (await tasks.getHistory(OTHER, "child")).find(
        (entry) => entry.id === "parent",
      ),
    ).toMatchObject({ oldValue: "PAGE-2", newValue: "PAGE-1" });
    expect(await repository.findVisibleKeys([], { departmentIds: [] })).toEqual(
      new Set(),
    );
  });

  it("hides foreign links and prevents creating new hidden references", async () => {
    const { tasks } = await setup();
    expect(
      (await tasks.findLinks(ACTOR, "root")).map((link) => link.id),
    ).toEqual(["front-link"]);
    await expect(
      tasks.addLink(ACTOR, "root", "PAGE-5", "blocks"),
    ).rejects.toThrow("does not exist");
    await expect(
      tasks.addLink(ACTOR, "root", "OTHER-1", "blocks"),
    ).rejects.toThrow("does not exist");
    expect(
      await tasks.addLink(ACTOR, "root", "PAGE-3", "relates_to"),
    ).toHaveLength(2);
    expect(await tasks.removeLink(ACTOR, "root", "front-link")).toHaveLength(1);
  });

  it("preserves a hidden existing parent when editing other fields and rejects newly selected hidden parents", async () => {
    const { tasks, repository } = await setup();
    const child = await tasks.getById(ACTOR, "child");
    expect(
      await tasks.update(ACTOR, "child", {
        ...updateInput(child),
        title: "Changed child",
      }),
    ).toMatchObject({
      title: "Changed child",
      parentId: null,
      parentKey: null,
    });
    expect(await repository.findById("child")).toMatchObject({
      parentId: "hidden",
      parentKey: "PAGE-2",
    });
    expect(
      (await tasks.getHistory(ACTOR, "child")).filter(
        (entry) => entry.action === "parent_changed",
      ),
    ).toHaveLength(3);
    const front = await tasks.getById(ACTOR, "front");
    await expect(
      tasks.update(ACTOR, "front", {
        ...updateInput(front),
        parentId: "hidden",
      }),
    ).rejects.toThrow("does not exist");
    await expect(
      tasks.create(ACTOR, {
        projectId: "p1",
        type: "task",
        title: "New child",
        statusId: "status-todo",
        parentId: "hidden",
        skipGitHubSync: true,
      }),
    ).rejects.toThrow("does not exist");
    expect(await repository.findById("front")).toMatchObject({
      parentId: "root",
    });
    expect(
      await tasks.update(ACTOR, "child", {
        ...updateInput(child),
        parentId: "root",
      }),
    ).toMatchObject({ parentId: "root", parentKey: "PAGE-1" });
  });

  it("rejects foreign status IDs in creation, editing and board moves", async () => {
    const { tasks } = await setup();
    const child = await tasks.getById(ACTOR, "child");
    await expect(
      tasks.update(ACTOR, child.id, {
        ...updateInput(child),
        statusId: "foreign-status",
      }),
    ).rejects.toThrow("does not exist");
    await expect(
      tasks.updateStatusAndOrder(ACTOR, child.id, "foreign-status", 0),
    ).rejects.toThrow("does not exist");
    await expect(
      tasks.create(ACTOR, {
        projectId: "p1",
        type: "task",
        title: "New task",
        statusId: "foreign-status",
        skipGitHubSync: true,
      }),
    ).rejects.toThrow("does not exist");
    expect(
      await tasks.updateStatusAndOrder(ACTOR, child.id, "local", 0),
    ).toMatchObject({ statusId: "local", parentId: null, parentKey: null });
  });

  it("blocks a subtree move containing hidden tickets before changing any rows", async () => {
    const { tasks, authorization, repository } = await setup();
    await authorization.saveAccount(createAccess({ allProjects: true }));
    await expect(tasks.moveToProject(ACTOR, "root", "p2")).rejects.toThrow(
      "does not exist",
    );
    for (const id of ["root", "front", "back"])
      expect(await repository.findById(id)).toMatchObject({ projectId: "p1" });
    expect(await tasks.moveToProject(ACTOR, "child", "p2")).toMatchObject({
      projectId: "p2",
      parentId: null,
    });
  });

  it("prevents cross-project goal and date IDs from bypassing the project scope", async () => {
    const { projects } = await setup();
    const repository = new ProjectRepository(getDatabase());
    await repository.insertGoal({
      id: "foreign-goal",
      projectId: "p2",
      title: "Foreign goal",
      position: 0,
    });
    const event = {
      title: "Foreign date",
      description: "",
      type: "general",
      eventDate: "2026-10-07",
      eventTime: null,
    };
    await repository.insertEvent({
      ...event,
      id: "foreign-event",
      projectId: "p2",
    });
    await expect(
      projects.updateGoal(ACTOR, "p1", "foreign-goal", {
        title: "Forged",
        isDone: true,
      }),
    ).rejects.toThrow("not allowed");
    await expect(
      projects.deleteGoal(ACTOR, "p1", "foreign-goal"),
    ).rejects.toThrow("not allowed");
    await expect(
      projects.updateEvent(ACTOR, "p1", "foreign-event", {
        ...event,
        title: "Forged",
      }),
    ).rejects.toThrow("not allowed");
    await expect(
      projects.archiveEvent(ACTOR, "p1", "foreign-event"),
    ).rejects.toThrow("not allowed");
    expect(await repository.findGoals("p2")).toMatchObject([
      { title: "Foreign goal", isDone: false },
    ]);
    expect(await repository.findEvents("p2")).toMatchObject([
      { title: "Foreign date" },
    ]);
  });

  it("denies a current reader general project writes without manager authority", async () => {
    const { projects, authorization } = await setup();
    await authorization.saveRole(
      createRole({ name: "Reader", permissions: [CAPABILITY.WRITE] }),
    );
    expect(await projects.getById(ACTOR, "p1")).toMatchObject({ id: "p1" });
    await expect(projects.setTags(ACTOR, "p1", ["Forged"])).rejects.toThrow(
      "not allowed",
    );
    expect(await projects.findTags(ACTOR, "p1")).toEqual([]);
  });

  it("drops assignment candidates when the project is archived during their lookup", async () => {
    const { tasks, projects, repository } = await setup();
    vi.spyOn(repository, "findEligibleAssignees").mockImplementationOnce(
      async () => {
        await getDatabase().execute(
          "UPDATE projects SET archived_at = utc_now() WHERE id = 'p1';",
        );
        return [ACTOR];
      },
    );
    expect(await tasks.findEligibleAssignees(ACTOR, "p1")).toEqual([]);
    const guard = new TaskAccessGuard(
      repository,
      projects,
      new PermissionService(),
    );
    const validator = new WorkItemReferenceValidator(repository, guard);
    expect(await validator.isEligibleAssignee(ACTOR.id, "p1")).toBe(false);
    await expect(validator.validateAssignee(ACTOR.id, "p1")).rejects.toThrow(
      "does not have access",
    );
  });

  it("rechecks assignment candidates against live project access even with a warm legacy catalog", async () => {
    const { tasks, authorization, projects } = await setup();
    expect(
      (await tasks.findAssigneesByProjects(["p2", "missing"]))
        .get("p2")
        ?.map((user) => user.id),
    ).toEqual(["other"]);
    expect(
      (await tasks.findEligibleAssignees(ACTOR, "p1")).map((user) => user.id),
    ).toEqual(["actor", "other"]);
    await authorization.saveAccount(
      createAccess({ userId: "other", departments: [] }),
    );
    expect(
      (await tasks.findAssigneesByProjects(["p2", "missing"])).get("p2"),
    ).toEqual([]);
    expect(
      (await tasks.findAssigneesByProjects(["p2", "missing"])).has("missing"),
    ).toBe(false);
    expect(
      (await tasks.findEligibleAssignees(ACTOR, "p1")).map((user) => user.id),
    ).toEqual(["actor"]);
    const child = await tasks.getById(ACTOR, "child");
    await expect(
      tasks.update(ACTOR, "child", {
        ...updateInput(child),
        assigneeId: "other",
      }),
    ).rejects.toThrow("does not have access");
    await getDatabase().execute(
      "INSERT INTO projects (id, name, owner_id) VALUES ('public', 'Public project', 'actor');",
    );
    const filtered = await projects.filterAssignees(
      new Map([
        ["public", [createUser({ id: "missing-account" }), ACTOR]],
        ["missing", [ACTOR]],
      ]),
    );
    expect(filtered.get("public")?.map((user) => user.id)).toEqual(["actor"]);
    expect(filtered.has("missing")).toBe(false);
    expect(await projects.filterAssignees(new Map())).toEqual(new Map());
  });
});
