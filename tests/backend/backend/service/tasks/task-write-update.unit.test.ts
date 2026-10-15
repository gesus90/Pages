import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  WorkItemAccessDeniedError,
  WorkItemNotFoundError,
} from "@/backend/error/WorkItemErrors";

import { TaskWorld } from "./task-world";

import type { UpdateWorkItemInput } from "@/backend/service/TaskService";

let world = new TaskWorld();
beforeEach(() => {
  world = new TaskWorld();
  world.addTicket("t1", {
    title: "Original",
    description: "Original text",
    createdBy: "writer",
    reporterName: "writer",
  });
});

function change(
  overrides: Partial<UpdateWorkItemInput> = {},
): UpdateWorkItemInput {
  return {
    title: "Original",
    statusId: "todo",
    priority: "normal",
    assigneeId: null,
    reporterId: "writer",
    parentId: null,
    milestoneId: null,
    dueAt: null,
    startAt: null,
    ...overrides,
  };
}

describe("updating a ticket", () => {
  it("stores every changed field and records one history entry for each", async () => {
    world.addMilestone("m1", "alpha", { name: "Release" });

    const updated = await world.tasks.update(
      world.user("writer"),
      "t1",
      change({
        title: "  Renamed ",
        description: "New text",
        statusId: "doing",
        priority: "high",
        assigneeId: "manager",
        reporterId: "manager",
        milestoneId: "m1",
        dueAt: "2026-06-01",
      }),
    );

    expect(updated).toMatchObject({
      title: "Renamed",
      description: "New text",
      statusId: "doing",
      priority: "high",
      assigneeId: "manager",
      createdBy: "manager",
      milestoneId: "m1",
      dueAt: "2026-06-01",
    });
    expect(
      world.state.history.map((entry) => [
        entry.action,
        entry.oldValue,
        entry.newValue,
        entry.userId,
      ]),
    ).toEqual([
      ["title_changed", "Original", "Renamed", "writer"],
      ["description_changed", "Original text", "New text", "writer"],
      ["status_changed", "To do", "In progress", "writer"],
      ["priority_changed", "normal", "high", "writer"],
      ["assignee_changed", null, "manager", "writer"],
      ["reporter_changed", "writer", "manager", "writer"],
      ["milestone_changed", null, "Release", "writer"],
      ["due_at_changed", null, "2026-06-01", "writer"],
    ]);
  });

  it("records nothing when no value changes", async () => {
    await world.tasks.update(world.user("writer"), "t1", change());

    expect(world.state.history).toEqual([]);
  });

  it("names the group as assignee in the history", async () => {
    world.state.groups.push({ id: "g1", name: "Crew", memberIds: ["writer"] });

    await world.tasks.update(
      world.user("writer"),
      "t1",
      change({ assigneeGroupId: "g1" }),
    );

    expect(world.state.history).toMatchObject([
      { action: "assignee_changed", newValue: "Crew" },
    ]);
  });

  it("keeps a description saved by someone else when none is sent", async () => {
    world.state.beforeWrite = () => {
      world.state.tickets.set("t1", {
        ...world.ticket("t1"),
        description: "Saved meanwhile",
      });
    };

    await world.tasks.update(
      world.user("writer"),
      "t1",
      change({ title: "Renamed" }),
    );

    expect(world.ticket("t1")).toMatchObject({
      title: "Renamed",
      description: "Saved meanwhile",
    });
  });

  it("accepts a description that already is the new text", async () => {
    await expect(
      world.tasks.update(
        world.user("writer"),
        "t1",
        change({
          description: "Original text",
          baseDescription: "Older text",
        }),
      ),
    ).resolves.toMatchObject({ description: "Original text" });
  });
});

describe("description conflicts on update", () => {
  it("refuses a description written from an outdated text", async () => {
    await expect(
      world.tasks.update(
        world.user("writer"),
        "t1",
        change({ description: "Mine", baseDescription: "Older text" }),
      ),
    ).rejects.toMatchObject({ code: "descriptionConflict" });
    expect(world.state.writes).toEqual([]);
    expect(world.ticket("t1").description).toBe("Original text");
  });

  it("refuses when the text changes between check and write", async () => {
    world.state.beforeWrite = () => {
      world.state.tickets.set("t1", {
        ...world.ticket("t1"),
        description: "Raced text",
      });
    };

    await expect(
      world.tasks.update(
        world.user("writer"),
        "t1",
        change({ description: "Mine", baseDescription: "Original text" }),
      ),
    ).rejects.toMatchObject({ code: "descriptionConflict" });
    expect(world.ticket("t1").description).toBe("Raced text");
    expect(world.state.history).toEqual([]);
  });
});

describe("refused ticket updates", () => {
  it.each([
    ["a blank title", { title: " " }, "titleLength"],
    [
      "an unknown priority",
      { priority: "asap" as "high" },
      "priorityUnsupported",
    ],
    ["an unknown status", { statusId: "nope" }, "statusNotFound"],
    [
      "a status of another project",
      { statusId: "beta-only" },
      "statusNotFound",
    ],
    ["a blank reporter", { reporterId: "  " }, "reporterRequired"],
    [
      "a reporter without project access",
      { reporterId: "outsider" },
      "assigneeNoProjectAccess",
    ],
    ["an unknown milestone", { milestoneId: "nope" }, "milestoneNotFound"],
  ])("rejects %s", async (_, overrides, code) => {
    await expect(
      world.tasks.update(world.user("writer"), "t1", change(overrides)),
    ).rejects.toMatchObject({ code });
    expect(world.state.writes).toEqual([]);
    expect(world.state.history).toEqual([]);
  });

  it("refuses an actor without the write capability", async () => {
    await expect(
      world.tasks.update(world.user("reader"), "t1", change({ title: "X" })),
    ).rejects.toBeInstanceOf(WorkItemAccessDeniedError);
    expect(world.ticket("t1").title).toBe("Original");
  });

  it("reports a ticket of a foreign department as missing", async () => {
    world.addTicket("hidden", { departmentId: "design" });

    await expect(
      world.tasks.update(world.user("writer"), "hidden", change()),
    ).rejects.toBeInstanceOf(WorkItemNotFoundError);
  });
});

describe("hidden parents", () => {
  beforeEach(() => {
    world.addTicket("secret-epic", {
      type: "epic",
      key: "ALP-7",
      departmentId: "design",
    });
    world.addTicket("child", { parentId: "secret-epic", key: "ALP-8" });
  });

  it("keeps a parent the actor cannot see when none is chosen", async () => {
    await world.tasks.update(
      world.user("writer"),
      "child",
      change({ title: "Child renamed" }),
    );

    expect(world.ticket("child").parentId).toBe("secret-epic");
    expect(world.actions("child")).toEqual(["title_changed"]);
  });

  it("lets an administrator see and replace the parent", async () => {
    world.addTicket("other-epic", { type: "epic", key: "ALP-9" });

    await world.tasks.update(
      world.user("admin"),
      "child",
      change({ title: "Title child", parentId: "other-epic" }),
    );

    expect(world.ticket("child").parentId).toBe("other-epic");
  });
});

describe("publishing an update", () => {
  it("hands the stored ticket to GitHub", async () => {
    world.attachGitHub(async () => undefined);

    await world.tasks.update(
      world.user("writer"),
      "t1",
      change({ title: "Renamed" }),
    );
    await world.settle();

    expect(world.published).toEqual(["t1"]);
  });

  it("clears an earlier synchronization error after a successful publication", async () => {
    world.addTicket("t1", { githubLastError: "old failure" });
    world.attachGitHub(async () => undefined);
    const invalidate = vi.spyOn(world.projects.cache, "invalidateWorkItems");

    await world.tasks.update(
      world.user("writer"),
      "t1",
      change({ title: "Renamed" }),
    );
    await world.settle();

    expect(world.ticket("t1").githubLastError).toBeNull();
    expect(invalidate).toHaveBeenCalled();
  });
});
