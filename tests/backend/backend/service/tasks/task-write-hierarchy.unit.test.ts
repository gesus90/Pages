import { beforeEach, describe, expect, it } from "vitest";

import { WorkItemAccessDeniedError } from "@/backend/error/WorkItemErrors";

import { TaskWorld } from "./task-world";

let world = new TaskWorld();
beforeEach(() => {
  world = new TaskWorld();
  world.addHierarchy();
  world.addTicket("epic-b", { type: "epic", parentId: "ini", key: "ALP-5" });
});

describe("moving below another parent", () => {
  it("stores the new parent and records the old and new key", async () => {
    const updated = await world.tasks.changeParent(
      world.user("writer"),
      "task",
      "epic-b",
    );

    expect(updated.parentId).toBe("epic-b");
    expect(world.state.history).toMatchObject([
      {
        workItemId: "task",
        action: "parent_changed",
        field: "parent",
        oldValue: "ALP-2",
        newValue: "ALP-5",
        userId: "writer",
      },
    ]);
  });

  it("removes the parent of a task and records an empty new key", async () => {
    const updated = await world.tasks.changeParent(
      world.user("writer"),
      "task",
      null,
    );

    expect(updated.parentId).toBeNull();
    expect(world.state.history).toMatchObject([
      { oldValue: "ALP-2", newValue: null },
    ]);
  });

  it("writes nothing when the parent stays", async () => {
    await world.tasks.changeParent(world.user("writer"), "task", "epic");

    expect(world.state.writes).toEqual([]);
    expect(world.state.history).toEqual([]);
  });
});

describe("parent validation and authorization", () => {
  it.each([
    ["itself", "task", "taskSelfParent"],
    ["an initiative", "ini", "taskParentType"],
    ["a missing ticket", "ghost", "epicMissing"],
  ])("rejects %s as the parent of a task", async (_, parentId, code) => {
    await expect(
      world.tasks.changeParent(world.user("writer"), "task", parentId),
    ).rejects.toMatchObject({ code });
    expect(world.ticket("task").parentId).toBe("epic");
  });

  it("requires a parent task for a subtask", async () => {
    await expect(
      world.tasks.changeParent(world.user("writer"), "sub", null),
    ).rejects.toMatchObject({ code: "subtaskParentRequired" });
  });

  it("rejects an archived new parent", async () => {
    world.addTicket("old-epic", {
      type: "epic",
      parentId: "ini",
      key: "ALP-6",
      archivedAt: "2026-01-02 00:00:00",
    });

    await expect(
      world.tasks.changeParent(world.user("writer"), "task", "old-epic"),
    ).rejects.toMatchObject({ code: "parentArchived" });
  });

  it("rejects a parent of another project", async () => {
    world.addTicket("foreign", { type: "epic", projectId: "spare" });

    await expect(
      world.tasks.changeParent(world.user("writer"), "task", "foreign"),
    ).rejects.toMatchObject({ code: "epicOtherProject" });
  });

  it("refuses an archived ticket", async () => {
    world.addTicket("old", {
      type: "task",
      archivedAt: "2026-01-02 00:00:00",
    });

    await expect(
      world.tasks.changeParent(world.user("writer"), "old", "epic"),
    ).rejects.toMatchObject({ code: "ticketArchived" });
  });

  it("refuses an actor without the write capability", async () => {
    await expect(
      world.tasks.changeParent(world.user("reader"), "task", "epic-b"),
    ).rejects.toBeInstanceOf(WorkItemAccessDeniedError);
  });

  it("keeps a parent of a foreign department when none is named", async () => {
    world.addTicket("secret-epic", {
      type: "epic",
      parentId: "ini",
      key: "ALP-7",
      departmentId: "design",
    });
    world.addTicket("hidden-child", {
      parentId: "secret-epic",
      key: "ALP-8",
    });

    const result = await world.tasks.changeParent(
      world.user("writer"),
      "hidden-child",
      null,
    );

    expect(result.id).toBe("hidden-child");
    expect(world.ticket("hidden-child").parentId).toBe("secret-epic");
    expect(world.state.writes).toEqual([]);
  });
});

describe("board position and status", () => {
  it("stores status and sort order and records the status move", async () => {
    const updated = await world.tasks.updateStatusAndOrder(
      world.user("writer"),
      "task",
      "doing",
      42,
    );

    expect(updated).toMatchObject({ statusId: "doing", sortOrder: 42 });
    expect(world.actions("task")).toEqual(["status_changed"]);
  });

  it("only reorders without a history entry inside the same column", async () => {
    await world.tasks.updateStatusAndOrder(
      world.user("writer"),
      "task",
      "todo",
      5,
    );

    expect(world.ticket("task").sortOrder).toBe(5);
    expect(world.state.history).toEqual([]);
  });

  it("rejects a status of another project", async () => {
    await expect(
      world.tasks.updateStatusAndOrder(
        world.user("writer"),
        "task",
        "beta-only",
        1,
      ),
    ).rejects.toMatchObject({ code: "targetStatusNotFound" });
    expect(world.state.writes).toEqual([]);
  });

  it("refuses an actor without the write capability", async () => {
    await expect(
      world.tasks.updateStatusAndOrder(
        world.user("reader"),
        "task",
        "doing",
        1,
      ),
    ).rejects.toBeInstanceOf(WorkItemAccessDeniedError);
  });
});
