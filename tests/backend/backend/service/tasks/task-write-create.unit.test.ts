import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectAccessDeniedError } from "@/backend/error/ProjectErrors";
import { WorkItemAccessDeniedError } from "@/backend/error/WorkItemErrors";

import { TaskWorld } from "./task-world";

import type { CreateWorkItemInput } from "@/backend/service/TaskService";

let world = new TaskWorld();
beforeEach(() => {
  world = new TaskWorld();
});

function input(
  overrides: Partial<CreateWorkItemInput> = {},
): CreateWorkItemInput {
  return {
    projectId: "alpha",
    type: "task",
    title: "  Write the report  ",
    description: "  Details  ",
    statusId: "todo",
    ...overrides,
  };
}

describe("creating a ticket", () => {
  it("stores the trimmed ticket with the next key and the actor as creator", async () => {
    const created = await world.tasks.create(world.user("writer"), input());

    expect(created).toMatchObject({
      key: "ALPH-1",
      number: 1,
      title: "Write the report",
      description: "Details",
      priority: "normal",
      statusId: "todo",
      createdBy: "writer",
      projectId: "alpha",
      departmentId: null,
    });
    expect(world.actions(created.id)).toEqual(["created"]);
  });

  it("numbers consecutive tickets of a project without gaps", async () => {
    const first = await world.tasks.create(world.user("writer"), input());
    const second = await world.tasks.create(world.user("writer"), input());

    expect([first.key, second.key]).toEqual(["ALPH-1", "ALPH-2"]);
    expect(first.id).not.toBe(second.id);
  });

  it("gives simultaneous requests distinct keys", async () => {
    const created = await Promise.all([
      world.tasks.create(world.user("writer"), input()),
      world.tasks.create(world.user("manager"), input()),
      world.tasks.create(world.user("lead"), input()),
    ]);

    expect(new Set(created.map((ticket) => ticket.key)).size).toBe(3);
  });

  it("keeps a separate sequence per project", async () => {
    world.projects.addProject("other", ["engineering"]);

    await world.tasks.create(world.user("writer"), input());
    const other = await world.tasks.create(
      world.user("writer"),
      input({ projectId: "other" }),
    );

    expect(other.number).toBe(1);
  });

  it("forgets cached ticket lists", async () => {
    const invalidate = vi.spyOn(world.projects.cache, "invalidateWorkItems");

    await world.tasks.create(world.user("writer"), input());

    expect(invalidate).toHaveBeenCalled();
  });

  it("accepts a project-bound status of its own project", async () => {
    const created = await world.tasks.create(
      world.user("outsider"),
      input({ projectId: "beta", statusId: "beta-only" }),
    );

    expect(created.statusId).toBe("beta-only");
  });
});

describe("refused ticket creation", () => {
  it("refuses an actor without the write capability", async () => {
    await expect(
      world.tasks.create(world.user("reader"), input()),
    ).rejects.toBeInstanceOf(WorkItemAccessDeniedError);
    expect(world.state.writes).toEqual([]);
  });

  it("refuses a project the actor cannot open", async () => {
    await expect(
      world.tasks.create(world.user("outsider"), input()),
    ).rejects.toBeInstanceOf(ProjectAccessDeniedError);
    expect(world.state.writes).toEqual([]);
  });

  it.each([
    ["a blank title", { title: "   " }, "titleLength"],
    ["a title above 200 characters", { title: "t".repeat(201) }, "titleLength"],
    [
      "a description above 65536 characters",
      { description: "d".repeat(65_537) },
      "descriptionTooLong",
    ],
    [
      "an unknown type",
      { type: "story" as CreateWorkItemInput["type"] },
      "typeUnsupported",
    ],
    [
      "an unknown priority",
      { priority: "asap" as CreateWorkItemInput["priority"] },
      "priorityUnsupported",
    ],
    ["an unknown status", { statusId: "nope" }, "statusNotFound"],
    [
      "a status of another project",
      { statusId: "beta-only" },
      "statusNotFound",
    ],
  ])("rejects %s", async (_, overrides, code) => {
    await expect(
      world.tasks.create(world.user("writer"), input(overrides)),
    ).rejects.toMatchObject({ code });
    expect(world.state.writes).toEqual([]);
    expect(world.state.history).toEqual([]);
  });

  it("accepts a title of exactly 200 characters", async () => {
    await expect(
      world.tasks.create(
        world.user("writer"),
        input({ title: "t".repeat(200) }),
      ),
    ).resolves.toMatchObject({ key: "ALPH-1" });
  });
});

describe("hierarchy of a new ticket", () => {
  beforeEach(() => {
    world.addHierarchy();
  });

  it.each([
    ["a subtask without a task", { type: "subtask" }, "subtaskParentRequired"],
    [
      "an initiative below another ticket",
      { type: "initiative", parentId: "ini" },
      "initiativeNoParent",
    ],
    [
      "a task directly below an initiative",
      { type: "task", parentId: "ini" },
      "taskParentType",
    ],
    [
      "an epic below a task",
      { type: "epic", parentId: "task" },
      "epicParentType",
    ],
    [
      "a task below a missing epic",
      { type: "task", parentId: "ghost" },
      "epicMissing",
    ],
  ] as const)("rejects %s", async (_, overrides, code) => {
    await expect(
      world.tasks.create(world.user("writer"), input(overrides)),
    ).rejects.toMatchObject({ code });
    expect(world.state.writes).toEqual([]);
  });

  it("accepts a task below an epic of the same project", async () => {
    const created = await world.tasks.create(
      world.user("writer"),
      input({ parentId: "epic" }),
    );

    expect(created.parentId).toBe("epic");
  });

  it("rejects an epic of another project", async () => {
    world.addTicket("foreign-epic", {
      type: "epic",
      projectId: "spare",
      key: "SP-1",
    });

    await expect(
      world.tasks.create(
        world.user("writer"),
        input({ parentId: "foreign-epic" }),
      ),
    ).rejects.toMatchObject({ code: "epicOtherProject" });
  });

  it("rejects an archived parent", async () => {
    world.addTicket("old-epic", {
      type: "epic",
      key: "ALP-9",
      archivedAt: "2026-01-02 00:00:00",
    });

    await expect(
      world.tasks.create(world.user("writer"), input({ parentId: "old-epic" })),
    ).rejects.toMatchObject({ code: "parentArchived" });
  });

  it("treats a parent of a foreign department as missing", async () => {
    world.addTicket("secret-epic", {
      type: "epic",
      key: "ALP-8",
      departmentId: "design",
    });

    await expect(
      world.tasks.create(
        world.user("writer"),
        input({ parentId: "secret-epic" }),
      ),
    ).rejects.toMatchObject({ code: "epicMissing" });
  });
});

describe("assignment and department of a new ticket", () => {
  it("rejects an assignee without access to the project", async () => {
    await expect(
      world.tasks.create(
        world.user("writer"),
        input({ assigneeId: "outsider" }),
      ),
    ).rejects.toMatchObject({ code: "assigneeNoProjectAccess" });
  });

  it("accepts an assignee with project access", async () => {
    const created = await world.tasks.create(
      world.user("writer"),
      input({ assigneeId: "manager" }),
    );

    expect(created.assigneeId).toBe("manager");
  });

  it("rejects an assignment to a person and a group together", async () => {
    world.state.groups.push({ id: "g1", name: "Crew", memberIds: ["writer"] });

    await expect(
      world.tasks.create(
        world.user("writer"),
        input({ assigneeId: "manager", assigneeGroupId: "g1" }),
      ),
    ).rejects.toMatchObject({ code: "assigneeAndGroup" });
  });

  it("rejects an unknown or empty group and accepts one with members", async () => {
    world.state.groups.push(
      { id: "empty", name: "Nobody", memberIds: [] },
      { id: "g1", name: "Crew", memberIds: ["writer"] },
    );

    await expect(
      world.tasks.create(world.user("writer"), input({ assigneeGroupId: "x" })),
    ).rejects.toMatchObject({ code: "groupNotFound" });
    await expect(
      world.tasks.create(
        world.user("writer"),
        input({ assigneeGroupId: "empty" }),
      ),
    ).rejects.toMatchObject({ code: "groupEmpty" });
    await expect(
      world.tasks.create(
        world.user("writer"),
        input({ assigneeGroupId: "g1" }),
      ),
    ).resolves.toMatchObject({ assigneeGroupId: "g1" });
  });

  it("rejects a milestone of another project and an unknown one", async () => {
    world.addMilestone("m-other", "spare");

    await expect(
      world.tasks.create(
        world.user("writer"),
        input({ milestoneId: "m-other" }),
      ),
    ).rejects.toMatchObject({ code: "milestoneOtherProject" });
    await expect(
      world.tasks.create(world.user("writer"), input({ milestoneId: "nope" })),
    ).rejects.toMatchObject({ code: "milestoneNotFound" });
  });

  it("stores an own department and refuses a foreign one", async () => {
    await expect(
      world.tasks.create(
        world.user("writer"),
        input({ departmentId: "engineering" }),
      ),
    ).resolves.toMatchObject({ departmentId: "engineering" });
    await expect(
      world.tasks.create(
        world.user("writer"),
        input({ departmentId: "design" }),
      ),
    ).rejects.toBeInstanceOf(WorkItemAccessDeniedError);
    await expect(
      world.tasks.create(
        world.user("writer"),
        input({ departmentId: "ghost" }),
      ),
    ).rejects.toMatchObject({ code: "departmentNotFound" });
  });

  it("treats a blank department as none", async () => {
    await expect(
      world.tasks.create(world.user("writer"), input({ departmentId: "  " })),
    ).resolves.toMatchObject({ departmentId: null });
  });
});

describe("publishing a new ticket", () => {
  it("hands the stored ticket to GitHub in the background", async () => {
    world.attachGitHub(async () => undefined);

    const created = await world.tasks.create(world.user("writer"), input());
    await world.settle();

    expect(world.published).toEqual([created.id]);
  });

  it("skips GitHub when asked to", async () => {
    world.attachGitHub(async () => undefined);

    await world.tasks.create(
      world.user("writer"),
      input({ skipGitHubSync: true }),
    );
    await world.settle();

    expect(world.published).toEqual([]);
  });

  it("does not fail the creation when GitHub fails and records the failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    world.attachGitHub(async () => {
      throw new Error("GitHub is down");
    });

    const created = await world.tasks.create(world.user("writer"), input());
    await world.settle();

    expect(world.ticket(created.id).githubLastError).toBe("GitHub is down");
    expect(world.actions(created.id)).toEqual([
      "created",
      "github_sync_failed",
    ]);
  });
});
