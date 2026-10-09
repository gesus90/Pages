import { describe, expect, it, vi } from "vitest";

import { PermissionService } from "@/backend/auth/PermissionService";
import { ServerCache } from "@/backend/cache/ServerCache";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import {
  WorkItemAccessDeniedError,
  WorkItemHierarchyError,
  WorkItemValidationError,
} from "@/backend/error/WorkItemErrors";
import { ProjectService } from "@/backend/service/ProjectService";
import { TaskService } from "@/backend/service/TaskService";
import { CAPABILITY } from "@/definition/Authorization";
import { ROLE } from "@/definition/Role";
import { WORK_ITEM_TYPE } from "@/definition/Task";

import { useMigratedDatabase } from "../helpers/test-database";

import type { Capability } from "@/definition/Authorization";
import type { WorkItemDetail, WorkItemType } from "@/definition/Task";
import type { User } from "@/definition/User";

/** Grants every capability except writing, like a reader role. */
class ReadOnlyPermissions extends PermissionService {
  public override async hasCapability(
    actor: User,
    capability: Capability,
  ): Promise<boolean> {
    return capability === CAPABILITY.WRITE
      ? false
      : super.hasCapability(actor, capability);
  }
}

interface Setup {
  readonly service: TaskService;
  readonly readOnly: TaskService;
  readonly admin: User;
  readonly employee: User;
  readonly repository: TaskRepository;
}

describe("ticket hierarchy (A8.2)", () => {
  const getDatabase = useMigratedDatabase();

  async function setup(): Promise<Setup> {
    const database = getDatabase();
    const users = new UserRepository(database);
    const projects = new ProjectRepository(database);
    const cache = ServerCache.disabled();
    const permissions = new PermissionService();
    const repository = new TaskRepository(database);

    for (const [id, role] of [
      ["user-admin", ROLE.ADMIN],
      ["user-employee", ROLE.EMPLOYEE],
    ] as const) {
      await users.insert({
        displayName: id,
        id,
        passwordHash: "hash",
        role,
        username: id,
      });
    }

    for (const id of ["project-1", "project-2"]) {
      await projects.insert({
        description: "",
        id,
        name: id,
        ownerId: "user-admin",
        placeholderColor: "#FCE3D3",
        status: "active",
      });
    }

    const projectService = new ProjectService(
      projects,
      permissions,
      null,
      cache,
    );
    const admin = await users.findById("user-admin");
    const employee = await users.findById("user-employee");

    if (!admin || !employee) {
      throw new Error("The fixtures were not stored.");
    }

    return {
      admin,
      employee,
      readOnly: new TaskService(
        repository,
        projectService,
        new ReadOnlyPermissions(),
        cache,
      ),
      repository,
      service: new TaskService(repository, projectService, permissions, cache),
    };
  }

  async function create(
    context: Setup,
    type: WorkItemType,
    options: { parentId?: string; projectId?: string; title?: string } = {},
  ): Promise<WorkItemDetail> {
    return context.service.create(context.admin, {
      parentId: options.parentId ?? null,
      projectId: options.projectId ?? "project-1",
      skipGitHubSync: true,
      statusId: "status-todo",
      title: options.title ?? type,
      type,
    });
  }

  async function createLevels(context: Setup): Promise<{
    readonly initiative: WorkItemDetail;
    readonly epic: WorkItemDetail;
    readonly task: WorkItemDetail;
    readonly subtask: WorkItemDetail;
  }> {
    const initiative = await create(context, WORK_ITEM_TYPE.INITIATIVE);
    const epic = await create(context, WORK_ITEM_TYPE.EPIC, {
      parentId: initiative.id,
    });
    const task = await create(context, WORK_ITEM_TYPE.TASK, {
      parentId: epic.id,
    });
    const subtask = await create(context, WORK_ITEM_TYPE.SUBTASK, {
      parentId: task.id,
    });

    return { epic, initiative, subtask, task };
  }

  function codeOf(error: unknown): string | null {
    return error instanceof WorkItemHierarchyError ||
      error instanceof WorkItemValidationError
      ? error.code
      : null;
  }

  async function rejection(work: Promise<unknown>): Promise<unknown> {
    return work.then(
      () => null,
      (error: unknown) => error,
    );
  }

  it("stores the four levels as real parent relations", async () => {
    const context = await setup();
    const levels = await createLevels(context);
    const all = await context.service.findAll(context.admin);
    const parentOf = new Map(all.map((item) => [item.id, item.parentId]));

    expect(parentOf.get(levels.initiative.id)).toBeNull();
    expect(parentOf.get(levels.epic.id)).toBe(levels.initiative.id);
    expect(parentOf.get(levels.task.id)).toBe(levels.epic.id);
    expect(parentOf.get(levels.subtask.id)).toBe(levels.task.id);
    expect(
      (await context.service.getByKey(context.admin, levels.subtask.key))
        .parentKey,
    ).toBe(levels.task.key);
  });

  it("moves tasks, subtasks and epics to another parent and records it", async () => {
    const context = await setup();
    const levels = await createLevels(context);
    const otherEpic = await create(context, WORK_ITEM_TYPE.EPIC);
    const otherTask = await create(context, WORK_ITEM_TYPE.TASK);

    const movedTask = await context.service.changeParent(
      context.admin,
      levels.task.id,
      otherEpic.id,
    );
    const movedSubtask = await context.service.changeParent(
      context.admin,
      levels.subtask.id,
      otherTask.id,
    );
    const detachedEpic = await context.service.changeParent(
      context.admin,
      levels.epic.id,
      null,
    );

    expect(movedTask.parentId).toBe(otherEpic.id);
    expect(movedSubtask.parentId).toBe(otherTask.id);
    expect(detachedEpic.parentId).toBeNull();
    expect(
      (await context.service.getHistory(context.admin, levels.task.id)).find(
        (entry) => entry.action === "parent_changed",
      ),
    ).toMatchObject({ newValue: otherEpic.key, oldValue: levels.epic.key });
    await expect(
      context.service.changeParent(context.admin, levels.task.id, otherEpic.id),
    ).resolves.toMatchObject({ parentId: otherEpic.id });
  });

  it("refuses parents of the wrong level, in another project, archived or below itself", async () => {
    const context = await setup();
    const levels = await createLevels(context);
    const foreignEpic = await create(context, WORK_ITEM_TYPE.EPIC, {
      projectId: "project-2",
    });
    const archivedEpic = await create(context, WORK_ITEM_TYPE.EPIC);

    await context.service.archive(context.admin, archivedEpic.id);

    const cases: [() => Promise<unknown>, string][] = [
      [
        () =>
          context.service.changeParent(
            context.admin,
            levels.task.id,
            levels.initiative.id,
          ),
        "taskParentType",
      ],
      [
        () =>
          context.service.changeParent(
            context.admin,
            levels.epic.id,
            levels.task.id,
          ),
        "epicParentType",
      ],
      [
        () =>
          context.service.changeParent(
            context.admin,
            levels.epic.id,
            levels.epic.id,
          ),
        "epicSelfParent",
      ],
      [
        () =>
          context.service.changeParent(
            context.admin,
            levels.task.id,
            foreignEpic.id,
          ),
        "epicOtherProject",
      ],
      [
        () =>
          context.service.changeParent(
            context.admin,
            levels.task.id,
            archivedEpic.id,
          ),
        "parentArchived",
      ],
      [
        () =>
          context.service.changeParent(context.admin, levels.subtask.id, null),
        "subtaskParentRequired",
      ],
      [
        () =>
          context.service.changeParent(
            context.admin,
            levels.initiative.id,
            levels.epic.id,
          ),
        "initiativeNoParent",
      ],
      [
        () =>
          context.service.changeParent(
            context.admin,
            levels.task.id,
            "missing",
          ),
        "epicMissing",
      ],
      [
        () =>
          create(context, WORK_ITEM_TYPE.TASK, { parentId: archivedEpic.id }),
        "parentArchived",
      ],
    ];

    for (const [work, code] of cases) {
      expect(codeOf(await rejection(work()))).toBe(code);
    }

    expect(
      (await context.service.getById(context.admin, levels.task.id)).parentId,
    ).toBe(levels.epic.id);
  });

  it("refuses parent and description changes without the right to write", async () => {
    const context = await setup();
    const levels = await createLevels(context);

    await expect(
      context.readOnly.changeParent(context.admin, levels.task.id, null),
    ).rejects.toBeInstanceOf(WorkItemAccessDeniedError);
    await expect(
      context.readOnly.updateDescription(context.admin, levels.task.id, {
        baseDescription: "",
        description: "Neu",
      }),
    ).rejects.toBeInstanceOf(WorkItemAccessDeniedError);
    await expect(
      context.readOnly.archive(context.admin, levels.task.id),
    ).rejects.toBeInstanceOf(WorkItemAccessDeniedError);
  });

  it("saves descriptions only from the current text and keeps other fields from overwriting them", async () => {
    const context = await setup();
    const { task } = await createLevels(context);

    const saved = await context.service.updateDescription(
      context.admin,
      task.id,
      {
        baseDescription: "",
        description: "  # Plan\n\n| a | b |\n| - | - |  ",
      },
    );

    expect(saved.description).toBe("# Plan\n\n| a | b |\n| - | - |");
    await expect(
      context.service.updateDescription(context.admin, task.id, {
        baseDescription: "",
        description: "Stale draft",
      }),
    ).rejects.toMatchObject({ code: "descriptionConflict" });
    await expect(
      context.service.updateDescription(context.admin, task.id, {
        baseDescription: "",
        description: saved.description,
      }),
    ).resolves.toMatchObject({ description: saved.description });
    await expect(
      context.service.updateDescription(context.admin, task.id, {
        baseDescription: saved.description,
        description: "x".repeat(65_537),
      }),
    ).rejects.toMatchObject({ code: "descriptionTooLong" });

    const updated = await context.service.update(context.admin, task.id, {
      assigneeId: null,
      dueAt: null,
      milestoneId: null,
      parentId: task.parentId,
      priority: "high",
      reporterId: context.admin.id,
      startAt: null,
      statusId: task.statusId,
      title: task.title,
    });

    expect(updated.description).toBe(saved.description);
    await expect(
      context.service.update(context.admin, task.id, {
        assigneeId: null,
        baseDescription: "",
        description: "Edited elsewhere",
        dueAt: null,
        milestoneId: null,
        parentId: task.parentId,
        priority: "high",
        reporterId: context.admin.id,
        startAt: null,
        statusId: task.statusId,
        title: task.title,
      }),
    ).rejects.toMatchObject({ code: "descriptionConflict" });
    await expect(
      context.service.update(context.admin, task.id, {
        assigneeId: null,
        baseDescription: saved.description,
        description: "Edited here",
        dueAt: null,
        milestoneId: null,
        parentId: task.parentId,
        priority: "high",
        reporterId: context.admin.id,
        startAt: null,
        statusId: task.statusId,
        title: task.title,
      }),
    ).resolves.toMatchObject({ description: "Edited here" });
  });

  it("refuses a description saved concurrently after its initial check", async () => {
    const context = await setup();
    const task = await create(context, WORK_ITEM_TYPE.TASK);
    const persist = context.repository.updateDescription.bind(
      context.repository,
    );

    vi.spyOn(context.repository, "updateDescription").mockImplementationOnce(
      async (...arguments_) => {
        await context.service.updateDescription(context.admin, task.id, {
          baseDescription: "",
          description: "Saved concurrently",
        });

        return persist(...arguments_);
      },
    );

    await expect(
      context.service.updateDescription(context.admin, task.id, {
        baseDescription: "",
        description: "First draft",
      }),
    ).rejects.toMatchObject({ code: "descriptionConflict" });
    expect(
      (await context.service.getById(context.admin, task.id)).description,
    ).toBe("Saved concurrently");
    expect(
      (await context.service.getHistory(context.admin, task.id)).filter(
        (entry) => entry.action === "description_changed",
      ),
    ).toHaveLength(1);
  });

  it.each([false, true])(
    "keeps concurrent descriptions during a field update (editing description: %s)",
    async (editsDescription) => {
      const context = await setup();
      const task = await create(context, WORK_ITEM_TYPE.TASK);
      const persist = context.repository.update.bind(context.repository);

      vi.spyOn(context.repository, "update").mockImplementationOnce(
        async (...arguments_) => {
          await context.service.updateDescription(context.admin, task.id, {
            baseDescription: "",
            description: "Saved concurrently",
          });

          return persist(...arguments_);
        },
      );

      const change = context.service.update(context.admin, task.id, {
        assigneeId: null,
        ...(editsDescription
          ? { baseDescription: "", description: "First draft" }
          : {}),
        dueAt: null,
        milestoneId: null,
        parentId: null,
        priority: "high",
        reporterId: context.admin.id,
        startAt: null,
        statusId: task.statusId,
        title: "New title",
      });

      if (editsDescription) {
        await expect(change).rejects.toMatchObject({
          code: "descriptionConflict",
        });
      } else {
        await expect(change).resolves.toMatchObject({ title: "New title" });
      }

      expect(
        (await context.service.getById(context.admin, task.id)).description,
      ).toBe("Saved concurrently");
      expect(
        (await context.service.getHistory(context.admin, task.id)).filter(
          (entry) => entry.action === "description_changed",
        ),
      ).toHaveLength(1);
    },
  );

  it("accepts exactly 65,536 description characters and refuses one more", async () => {
    const context = await setup();
    const task = await create(context, WORK_ITEM_TYPE.TASK);
    const description = "x".repeat(65_536);

    await expect(
      context.service.updateDescription(context.admin, task.id, {
        baseDescription: "",
        description,
      }),
    ).resolves.toMatchObject({ description });
    await expect(
      context.service.updateDescription(context.admin, task.id, {
        baseDescription: description,
        description: `${description}x`,
      }),
    ).rejects.toMatchObject({ code: "descriptionTooLong" });
    expect(
      (await context.service.getById(context.admin, task.id)).description,
    ).toBe(description);
  });

  it.each(["description", "form"])(
    "accepts the exact saved base of a GitHub description through %s",
    async (mode) => {
      const context = await setup();
      const task = await create(context, WORK_ITEM_TYPE.TASK);
      const change = { baseDescription: "# Remote\n", description: "Edited" };

      await context.repository.updateFromGitHub(task.id, {
        description: change.baseDescription,
        statusId: task.statusId,
        title: task.title,
      });

      const saving =
        mode === "description"
          ? context.service.updateDescription(context.admin, task.id, change)
          : context.service.update(context.admin, task.id, {
              ...change,
              assigneeId: null,
              dueAt: null,
              milestoneId: null,
              parentId: null,
              priority: task.priority,
              reporterId: context.admin.id,
              startAt: null,
              statusId: task.statusId,
              title: task.title,
            });

      await expect(saving).resolves.toMatchObject({ description: "Edited" });
    },
  );

  it("counts the descendants an archive or deletion reaches", async () => {
    const context = await setup();
    const levels = await createLevels(context);
    const archivedTask = await create(context, WORK_ITEM_TYPE.TASK, {
      parentId: levels.epic.id,
    });

    await context.service.archive(context.admin, archivedTask.id);

    await expect(
      context.service.describeDescendants(context.admin, levels.initiative.id),
    ).resolves.toEqual({
      active: { epic: 1, initiative: 0, subtask: 1, task: 1 },
      all: { epic: 1, initiative: 0, subtask: 1, task: 2 },
    });
  });

  it("archives with all descendants and restores only below an active parent", async () => {
    const context = await setup();
    const levels = await createLevels(context);

    await context.service.archive(context.admin, levels.epic.id);

    const active = await context.service.findAll(context.admin);

    expect(active.map((item) => item.id)).toEqual([levels.initiative.id]);
    await expect(
      context.service.restore(context.admin, levels.task.id),
    ).rejects.toMatchObject({ code: "parentArchived" });
    await expect(
      context.service.changeParent(context.admin, levels.task.id, null),
    ).rejects.toMatchObject({ code: "ticketArchived" });

    await context.service.restore(context.admin, levels.epic.id);

    expect(
      (await context.service.findAll(context.admin)).map((item) => item.id),
    ).toHaveLength(4);
  });

  it("keeps the children of an archived epic or initiative active without a parent", async () => {
    const context = await setup();
    const levels = await createLevels(context);
    const archivedChild = await create(context, WORK_ITEM_TYPE.TASK, {
      parentId: levels.epic.id,
    });

    await context.service.archive(context.admin, archivedChild.id);
    await context.service.archive(context.admin, levels.epic.id, "keep");

    const task = await context.service.getById(context.admin, levels.task.id);
    const child = await context.service.getById(
      context.admin,
      archivedChild.id,
    );

    expect(task).toMatchObject({ archivedAt: null, parentId: null });
    expect(
      (await context.service.getById(context.admin, levels.subtask.id))
        .parentId,
    ).toBe(levels.task.id);
    expect(child.parentId).toBe(levels.epic.id);
    expect(
      (await context.service.getHistory(context.admin, levels.task.id)).some(
        (entry) =>
          entry.action === "parent_changed" &&
          entry.oldValue === levels.epic.key &&
          entry.newValue === null,
      ),
    ).toBe(true);
    await expect(
      context.service.archive(context.admin, levels.task.id, "keep"),
    ).rejects.toMatchObject({ code: "subtasksStayWithTask" });
  });

  it("deletes for good with or without the children and removes their files", async () => {
    const context = await setup();
    const levels = await createLevels(context);
    const removeFiles = vi.fn(async () => {});
    const database = getDatabase();

    context.service.setAttachmentFiles({ removeFiles });
    await database.execute(
      `INSERT INTO work_item_attachments (id, work_item_id, file_name, content_type, kind, size, checksum, storage_name, uploaded_by)
       VALUES ('a1', $task_id, 'plan.pdf', 'application/octet-stream', 'file', 3, 'x', 'stored-1', 'user-admin');`,
      { task_id: levels.task.id },
    );

    await expect(
      context.service.deletePermanently(context.employee, levels.task.id),
    ).rejects.toBeInstanceOf(WorkItemAccessDeniedError);

    await context.service.deletePermanently(
      context.admin,
      levels.initiative.id,
      "keep",
    );

    expect(
      (await context.service.getById(context.admin, levels.epic.id)).parentId,
    ).toBeNull();
    expect(removeFiles).toHaveBeenLastCalledWith([]);

    await context.service.deletePermanently(context.admin, levels.epic.id);

    expect(await context.service.findAll(context.admin)).toEqual([]);
    expect(removeFiles).toHaveBeenLastCalledWith(["stored-1"]);
    await expect(
      database.query("SELECT COUNT(*) FROM work_item_attachments;"),
    ).resolves.toEqual([[0]]);
  });

  it("deletes for good without a file store attached", async () => {
    const context = await setup();
    const { task } = await createLevels(context);

    await context.service.deletePermanently(context.admin, task.id);

    expect(
      (await context.service.findAll(context.admin)).map((item) => item.type),
    ).toEqual([WORK_ITEM_TYPE.INITIATIVE, WORK_ITEM_TYPE.EPIC]);
  });

  it("keeps a hidden parent when the person chooses none", async () => {
    const context = await setup();
    const { epic, task } = await createLevels(context);

    vi.spyOn(context.repository, "findById").mockImplementation(
      async (id, visibility) =>
        id === task.id && visibility
          ? { ...task, parentId: null, parentKey: null }
          : null,
    );
    vi.spyOn(context.repository, "findParentReference").mockResolvedValue({
      id: epic.id,
      key: epic.key,
    });

    await expect(
      context.service.changeParent(context.admin, task.id, null),
    ).resolves.toMatchObject({ parentId: null });
    expect(context.repository.findParentReference).toHaveBeenCalledWith(
      task.id,
    );
  });
});
