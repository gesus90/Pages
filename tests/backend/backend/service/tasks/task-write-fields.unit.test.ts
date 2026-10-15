import { beforeEach, describe, expect, it } from "vitest";

import {
  WorkItemAccessDeniedError,
  WorkItemConflictError,
} from "@/backend/error/WorkItemErrors";

import { TaskWorld } from "./task-world";

let world = new TaskWorld();
beforeEach(() => {
  world = new TaskWorld();
  world.addTicket("t1", { title: "Original", description: "Original text" });
});

function race(id: string, changes: Record<string, unknown>): void {
  world.state.beforeWrite = () => {
    world.state.tickets.set("t1", { ...world.ticket(id), ...changes });
  };
}

describe("description change", () => {
  it("saves a trimmed description and records it", async () => {
    const updated = await world.tasks.updateDescription(
      world.user("writer"),
      "t1",
      { description: "  New text  ", baseDescription: "Original text" },
    );

    expect(updated.description).toBe("New text");
    expect(world.state.history).toMatchObject([
      {
        action: "description_changed",
        oldValue: "Original text",
        newValue: "New text",
        userId: "writer",
      },
    ]);
  });

  it("stores a verbatim description untouched", async () => {
    const updated = await world.tasks.updateDescription(
      world.user("writer"),
      "t1",
      {
        description: "  keeps spaces \n",
        baseDescription: "Original text",
        isVerbatim: true,
      },
    );

    expect(updated.description).toBe("  keeps spaces \n");
  });

  it("returns the ticket without writing when the text is the same", async () => {
    await world.tasks.updateDescription(world.user("writer"), "t1", {
      description: "Original text",
      baseDescription: "Original text",
    });

    expect(world.state.writes).toEqual([]);
    expect(world.state.history).toEqual([]);
  });

  it("refuses a description written from an outdated text", async () => {
    await expect(
      world.tasks.updateDescription(world.user("writer"), "t1", {
        description: "Mine",
        baseDescription: "Older",
      }),
    ).rejects.toMatchObject({ code: "descriptionConflict" });
    expect(world.ticket("t1").description).toBe("Original text");
  });

  it("refuses when the text changes between check and write", async () => {
    race("t1", { description: "Raced text" });

    await expect(
      world.tasks.updateDescription(world.user("writer"), "t1", {
        description: "Mine",
        baseDescription: "Original text",
      }),
    ).rejects.toMatchObject({ code: "descriptionConflict" });
    expect(world.ticket("t1").description).toBe("Raced text");
    expect(world.state.history).toEqual([]);
  });

  it("refuses an archived ticket", async () => {
    world.addTicket("old", { archivedAt: "2026-01-02 00:00:00" });

    await expect(
      world.tasks.updateDescription(world.user("writer"), "old", {
        description: "x",
        baseDescription: "Description old",
      }),
    ).rejects.toMatchObject({ code: "ticketArchived" });
  });

  it("limits the description to 65536 characters", async () => {
    await expect(
      world.tasks.updateDescription(world.user("writer"), "t1", {
        description: "d".repeat(65_537),
        baseDescription: "Original text",
      }),
    ).rejects.toMatchObject({ code: "descriptionTooLong" });
  });

  it("refuses an actor without the write capability", async () => {
    await expect(
      world.tasks.updateDescription(world.user("reader"), "t1", {
        description: "x",
        baseDescription: "Original text",
      }),
    ).rejects.toBeInstanceOf(WorkItemAccessDeniedError);
  });
});

describe("title change", () => {
  it("replaces the title and records old and new value", async () => {
    const updated = await world.tasks.updateTitle(world.user("writer"), "t1", {
      title: "  Better  ",
      baseTitle: "Original",
    });

    expect(updated.title).toBe("Better");
    expect(world.state.history).toMatchObject([
      { action: "title_changed", oldValue: "Original", newValue: "Better" },
    ]);
  });

  it("does nothing when the ticket already has the title", async () => {
    await world.tasks.updateTitle(world.user("writer"), "t1", {
      title: "Original",
      baseTitle: "Original",
    });

    expect(world.state.writes).toEqual([]);
  });

  it("accepts a title someone else already saved", async () => {
    world.addTicket("t1", { title: "Theirs" });

    await expect(
      world.tasks.updateTitle(world.user("writer"), "t1", {
        title: "Theirs",
        baseTitle: "Original",
      }),
    ).resolves.toMatchObject({ title: "Theirs" });
    expect(world.state.history).toEqual([]);
  });

  it("raises a conflict for a title changed since it was read", async () => {
    world.addTicket("t1", { title: "Theirs" });

    const attempt = world.tasks.updateTitle(world.user("writer"), "t1", {
      title: "Mine",
      baseTitle: "Original",
    });

    await expect(attempt).rejects.toBeInstanceOf(WorkItemConflictError);
    await expect(attempt).rejects.toMatchObject({ field: "title" });
    expect(world.ticket("t1").title).toBe("Theirs");
  });

  it("raises a conflict when the title changes between check and write", async () => {
    race("t1", { title: "Raced" });

    await expect(
      world.tasks.updateTitle(world.user("writer"), "t1", {
        title: "Mine",
        baseTitle: "Original",
      }),
    ).rejects.toMatchObject({ field: "title" });
    expect(world.ticket("t1").title).toBe("Raced");
    expect(world.state.history).toEqual([]);
  });

  it.each(["   ", "t".repeat(201)])("rejects the title %#", async (title) => {
    await expect(
      world.tasks.updateTitle(world.user("writer"), "t1", {
        title,
        baseTitle: "Original",
      }),
    ).rejects.toMatchObject({ code: "titleLength" });
  });

  it("refuses an archived ticket", async () => {
    world.addTicket("old", { archivedAt: "2026-01-02 00:00:00" });

    await expect(
      world.tasks.updateTitle(world.user("writer"), "old", {
        title: "x",
        baseTitle: "Title old",
      }),
    ).rejects.toMatchObject({ code: "ticketArchived" });
  });
});

describe("status change", () => {
  it("moves the ticket and keeps its sort order", async () => {
    world.addTicket("t1", { sortOrder: 7 });

    const updated = await world.tasks.updateStatus(world.user("writer"), "t1", {
      statusId: "done",
      baseStatusId: "todo",
    });

    expect(updated).toMatchObject({ statusId: "done", sortOrder: 7 });
    expect(world.state.history).toMatchObject([
      { action: "status_changed", oldValue: "To do", newValue: "Done" },
    ]);
  });

  it("raises a conflict for a status changed since it was read", async () => {
    world.addTicket("t1", { statusId: "doing" });

    await expect(
      world.tasks.updateStatus(world.user("writer"), "t1", {
        statusId: "done",
        baseStatusId: "todo",
      }),
    ).rejects.toMatchObject({ field: "status" });
    expect(world.ticket("t1").statusId).toBe("doing");
  });

  it("raises a conflict when the status changes between check and write", async () => {
    race("t1", { statusId: "doing" });

    await expect(
      world.tasks.updateStatus(world.user("writer"), "t1", {
        statusId: "done",
        baseStatusId: "todo",
      }),
    ).rejects.toBeInstanceOf(WorkItemConflictError);
  });

  it("does nothing when the ticket is already in the status", async () => {
    await world.tasks.updateStatus(world.user("writer"), "t1", {
      statusId: "todo",
      baseStatusId: "todo",
    });

    expect(world.state.writes).toEqual([]);
  });

  it("rejects a status of another project", async () => {
    await expect(
      world.tasks.updateStatus(world.user("writer"), "t1", {
        statusId: "beta-only",
        baseStatusId: "todo",
      }),
    ).rejects.toMatchObject({ code: "targetStatusNotFound" });
  });
});

describe("parent change", () => {
  beforeEach(() => {
    world.addHierarchy();
    world.addTicket("epic-b", { type: "epic", parentId: "ini", key: "ALP-5" });
  });

  it("moves a task below another epic and records the keys", async () => {
    const updated = await world.tasks.updateParent(
      world.user("writer"),
      "task",
      {
        parentId: "epic-b",
        baseParentId: "epic",
      },
    );

    expect(updated.parentId).toBe("epic-b");
    expect(world.state.history).toMatchObject([
      {
        action: "parent_changed",
        oldValue: "ALP-2",
        newValue: "ALP-5",
        workItemId: "task",
      },
    ]);
  });

  it("raises a conflict for a parent changed since it was read", async () => {
    await expect(
      world.tasks.updateParent(world.user("writer"), "task", {
        parentId: "epic-b",
        baseParentId: "ini",
      }),
    ).rejects.toMatchObject({ field: "parent" });
    expect(world.ticket("task").parentId).toBe("epic");
  });

  it("raises a conflict when the parent changes between check and write", async () => {
    world.state.beforeWrite = () => {
      world.state.tickets.set("task", {
        ...world.ticket("task"),
        parentId: null,
      });
    };

    await expect(
      world.tasks.updateParent(world.user("writer"), "task", {
        parentId: "epic-b",
        baseParentId: "epic",
      }),
    ).rejects.toMatchObject({ field: "parent" });
  });

  it("does nothing when the parent is already the requested one", async () => {
    await world.tasks.updateParent(world.user("writer"), "task", {
      parentId: "epic",
      baseParentId: "epic",
    });

    expect(world.state.writes).toEqual([]);
  });

  it("rejects a parent that violates the hierarchy", async () => {
    await expect(
      world.tasks.updateParent(world.user("writer"), "task", {
        parentId: "task",
        baseParentId: "epic",
      }),
    ).rejects.toMatchObject({ code: "taskSelfParent" });
    await expect(
      world.tasks.updateParent(world.user("writer"), "sub", {
        parentId: null,
        baseParentId: "task",
      }),
    ).rejects.toMatchObject({ code: "subtaskParentRequired" });
  });
});
