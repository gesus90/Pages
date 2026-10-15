import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  WorkItemAccessDeniedError,
  WorkItemNotFoundError,
} from "@/backend/error/WorkItemErrors";

import { TaskWorld } from "./task-world";

let world = new TaskWorld();
beforeEach(() => {
  world = new TaskWorld();
  world.addHierarchy();
});

describe("descendant overview", () => {
  it("counts visible descendants per type and the archive hint", async () => {
    world.addTicket("old-task", {
      type: "task",
      parentId: "epic",
      key: "ALP-9",
      archivedAt: "2026-01-02 00:00:00",
    });
    world.addTicket("secret", {
      type: "task",
      parentId: "epic",
      key: "ALP-10",
      departmentId: "design",
    });

    const overview = await world.tasks.describeDescendants(
      world.user("manager"),
      "epic",
    );

    expect(overview).toEqual({
      active: { epic: 0, initiative: 0, subtask: 1, task: 1 },
      all: { epic: 0, initiative: 0, subtask: 1, task: 2 },
      canArchive: true,
    });
  });

  it("reports that a plain writer cannot archive", async () => {
    const overview = await world.tasks.describeDescendants(
      world.user("writer"),
      "epic",
    );

    expect(overview.canArchive).toBe(false);
  });

  it("reports a hidden ticket as missing", async () => {
    world.addTicket("secret", { departmentId: "design" });

    await expect(
      world.tasks.describeDescendants(world.user("writer"), "secret"),
    ).rejects.toBeInstanceOf(WorkItemNotFoundError);
  });
});

describe("archiving", () => {
  it("archives the ticket with its descendants and records each", async () => {
    const count = await world.tasks.archive(world.user("manager"), "task");

    expect(count).toBe(2);
    expect(world.ticket("task").archivedAt).not.toBeNull();
    expect(world.ticket("sub").archivedAt).not.toBeNull();
    expect(world.ticket("epic").archivedAt).toBeNull();
    expect(world.actions("task")).toEqual(["archived"]);
    expect(world.actions("sub")).toEqual(["archived"]);
  });

  it("lets an administrator archive", async () => {
    await expect(
      world.tasks.archive(world.user("admin"), "task"),
    ).resolves.toBe(2);
  });

  it("forgets cached ticket lists only when something changed", async () => {
    const invalidate = vi.spyOn(world.projects.cache, "invalidateWorkItems");
    await world.tasks.archive(world.user("manager"), "task");
    expect(invalidate).toHaveBeenCalledTimes(1);

    const count = await world.tasks.archive(world.user("manager"), "task");

    expect(count).toBe(0);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it.each(["writer", "milestoner", "reader"])(
    "refuses %s without the archive right and changes nothing",
    async (userId) => {
      await expect(
        world.tasks.archive(world.user(userId), "task"),
      ).rejects.toBeInstanceOf(WorkItemAccessDeniedError);
      expect(world.ticket("task").archivedAt).toBeNull();
      expect(world.state.history).toEqual([]);
    },
  );

  it("refuses a ticket of a project outside the actor's departments", async () => {
    world.addTicket("beta-task", {
      projectId: "beta",
      departmentId: "design",
    });

    await expect(
      world.tasks.archive(world.user("manager"), "beta-task"),
    ).rejects.toBeInstanceOf(WorkItemNotFoundError);
  });

  it("refuses when descendants are hidden from the actor", async () => {
    world.addTicket("secret", {
      type: "subtask",
      parentId: "task",
      key: "ALP-11",
      departmentId: "design",
    });

    await expect(
      world.tasks.archive(world.user("manager"), "task"),
    ).rejects.toMatchObject({ code: "descendantsHidden" });
    expect(world.state.writes).toEqual([]);
  });

  it("keeps the children without a parent when asked to", async () => {
    const count = await world.tasks.archive(
      world.user("manager"),
      "epic",
      "keep",
    );

    expect(count).toBe(1);
    expect(world.ticket("task").parentId).toBeNull();
    expect(world.ticket("task").archivedAt).toBeNull();
    expect(world.ticket("sub").parentId).toBe("task");
    expect(world.state.history).toMatchObject([
      { workItemId: "task", action: "parent_changed", oldValue: "ALP-2" },
      { workItemId: "epic", action: "archived" },
    ]);
  });

  it("never separates subtasks from their task", async () => {
    await expect(
      world.tasks.archive(world.user("manager"), "task", "keep"),
    ).rejects.toMatchObject({ code: "subtasksStayWithTask" });
    expect(world.ticket("sub").parentId).toBe("task");
  });
});

describe("restoring", () => {
  beforeEach(async () => {
    await world.tasks.archive(world.user("manager"), "task");
    world.state.history.length = 0;
    world.state.writes.length = 0;
  });

  it("restores the ticket and its descendants and records each", async () => {
    await world.tasks.restore(world.user("writer"), "task");

    expect(world.ticket("task").archivedAt).toBeNull();
    expect(world.ticket("sub").archivedAt).toBeNull();
    expect(world.actions("task")).toEqual(["restored"]);
    expect(world.actions("sub")).toEqual(["restored"]);
  });

  it("refuses to restore below an archived parent", async () => {
    world.addTicket("epic", {
      ...world.ticket("epic"),
      archivedAt: "2026-01-02 00:00:00",
    });

    await expect(
      world.tasks.restore(world.user("writer"), "task"),
    ).rejects.toMatchObject({ code: "parentArchived" });
    expect(world.ticket("task").archivedAt).not.toBeNull();
  });

  it("refuses an actor without the write capability", async () => {
    await expect(
      world.tasks.restore(world.user("reader"), "task"),
    ).rejects.toBeInstanceOf(WorkItemAccessDeniedError);
  });
});

describe("permanent deletion", () => {
  it("removes the subtree and hands the file names to the remover", async () => {
    const removeFiles = vi.fn(async () => undefined);
    world.tasks.setAttachmentFiles({ removeFiles });
    world.state.storageNames.set("task", ["file-a"]);
    world.state.storageNames.set("sub", ["file-b"]);

    await world.tasks.deletePermanently(world.user("admin"), "task");

    expect([...world.state.tickets.keys()].sort()).toEqual(["epic", "ini"]);
    expect(removeFiles).toHaveBeenCalledWith(["file-a", "file-b"]);
  });

  it("forgets label and GitHub caches as well", async () => {
    const labels = vi.spyOn(world.projects.cache, "invalidateLabels");
    const github = vi.spyOn(world.projects.cache, "invalidateGitHub");

    await world.tasks.deletePermanently(world.user("admin"), "task");

    expect(labels).toHaveBeenCalled();
    expect(github).toHaveBeenCalled();
  });

  it.each(["manager", "writer", "lead"])(
    "refuses %s before looking at the ticket",
    async (userId) => {
      await expect(
        world.tasks.deletePermanently(world.user(userId), "task"),
      ).rejects.toBeInstanceOf(WorkItemAccessDeniedError);
      await expect(
        world.tasks.deletePermanently(world.user(userId), "ghost"),
      ).rejects.toBeInstanceOf(WorkItemAccessDeniedError);
      expect(world.state.tickets.has("task")).toBe(true);
    },
  );

  it("keeps direct children, archived ones included, when asked to", async () => {
    world.addTicket("old-task", {
      type: "task",
      parentId: "epic",
      key: "ALP-9",
      archivedAt: "2026-01-02 00:00:00",
    });

    await world.tasks.deletePermanently(world.user("admin"), "epic", "keep");

    expect(world.state.tickets.has("epic")).toBe(false);
    expect(world.ticket("task").parentId).toBeNull();
    expect(world.ticket("old-task").parentId).toBeNull();
    expect(world.state.tickets.has("sub")).toBe(true);
  });

  it("never separates subtasks from their task", async () => {
    await expect(
      world.tasks.deletePermanently(world.user("admin"), "task", "keep"),
    ).rejects.toMatchObject({ code: "subtasksStayWithTask" });
    expect(world.state.tickets.has("task")).toBe(true);
  });

  it("reports a missing ticket for an administrator", async () => {
    await expect(
      world.tasks.deletePermanently(world.user("admin"), "ghost"),
    ).rejects.toBeInstanceOf(WorkItemNotFoundError);
  });
});
