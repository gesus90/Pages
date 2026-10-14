import { beforeEach, expect, it, vi } from "vitest";

import { TaskRepository } from "@/backend/database/repositories/TaskRepository";

import { ArchiveWorld } from "./archive-world";

let world = new ArchiveWorld();
beforeEach(() => {
  world = new ArchiveWorld();
});

it("archives active descendants recursively and counts only changed rows", async () => {
  world.addTicket("root", { type: "initiative" });
  world.addTicket("epic", { type: "epic", parentId: "root" });
  world.addTicket("task", { parentId: "epic" });
  world.addTicket("subtask", { type: "subtask", parentId: "task" });
  world.addTicket("old", {
    type: "epic",
    parentId: "root",
    archivedAt: "2026-01-02 00:00:00",
  });
  world.addTicket("under-old", { parentId: "old" });
  world.addTicket("unrelated");
  const first = await world.call("manager", "ticket.delete");
  expect(first).toMatchObject({
    changed: true,
    affectedCount: 5,
    recursive: true,
    disposition: "trash",
  });
  expect(world.history.map((entry) => entry.workItemId).sort()).toEqual([
    "epic",
    "root",
    "subtask",
    "task",
    "under-old",
  ]);
  expect(world.history.every((entry) => entry.action === "archived")).toBe(
    true,
  );
  expect(world.tickets.get("old")?.archivedAt).toBe("2026-01-02 00:00:00");
  expect(world.tickets.get("unrelated")?.archivedAt).toBeNull();
  expect(
    [...world.tickets.values()].every((ticket) => ticket.statusId === "todo"),
  ).toBe(true);
  expect(await world.call("manager", "ticket.delete")).toEqual(first);
  expect(world.history).toHaveLength(5);
  expect(world.activity).toHaveLength(1);
});

it("does not count an already archived root again with a fresh operationId", async () => {
  world.addTicket("root", { archivedAt: "2026-01-02 00:00:00" });
  world.addTicket("subtask", { type: "subtask", parentId: "root" });
  await expect(world.call("manager", "ticket.delete")).resolves.toMatchObject({
    affectedCount: 1,
  });
  expect(world.history.map((entry) => entry.workItemId)).toEqual(["subtask"]);
  await expect(
    world.call(
      "manager",
      "ticket.delete",
      world.request("ticket.delete", "second-call"),
    ),
  ).resolves.toMatchObject({ changed: false, affectedCount: 0 });
  expect(world.history).toHaveLength(1);
  expect(world.activity).toHaveLength(1);
  expect(world.events).toHaveLength(1);
});

it("rejects a subtree with hidden descendants atomically", async () => {
  world.addTicket("visible-child", { type: "subtask", parentId: "root" });
  world.addTicket("hidden-child", {
    type: "subtask",
    parentId: "root",
    departmentId: "design",
  });
  const before = world.changes();
  await expect(world.call("manager", "ticket.delete")).rejects.toMatchObject({
    code: "INVALID_REQUEST",
  });
  expect(world.changes()).toEqual(before);
  expect(
    [...world.tickets.values()].every((ticket) => ticket.archivedAt === null),
  ).toBe(true);
  await expect(world.call("admin", "ticket.delete")).resolves.toMatchObject({
    affectedCount: 3,
  });
});

it("archives only the milestone, removing incident dependencies while preserving tickets and assignments", async () => {
  world.dependencies = [
    {
      id: "incoming",
      projectId: "engineering",
      sourceId: "before",
      targetId: "milestone",
      linkType: "blocks",
      createdAt: "2026-01-01",
    },
    {
      id: "outgoing",
      projectId: "engineering",
      sourceId: "milestone",
      targetId: "after",
      linkType: "follows",
      createdAt: "2026-01-01",
    },
    {
      id: "unrelated",
      projectId: "engineering",
      sourceId: "before",
      targetId: "after",
      linkType: "relates_to",
      createdAt: "2026-01-01",
    },
  ];
  world.addTicket("child", { type: "subtask", parentId: "root" });
  const tickets = [...world.tickets.values()];
  const first = await world.call("manager", "milestone.delete");
  expect(first).toMatchObject({ affectedCount: 1, disposition: "trash" });
  expect(world.milestones.get("milestone")).toMatchObject({
    status: "open",
    archivedAt: "2026-10-14 00:00:00",
  });
  expect(world.dependencies.map((dependency) => dependency.id)).toEqual([
    "unrelated",
  ]);
  expect([...world.tickets.values()]).toEqual(tickets);
  expect(world.history).toHaveLength(0);
  expect(world.activity).toHaveLength(1);
  expect(await world.call("manager", "milestone.delete")).toEqual(first);
  expect(world.writes.dependencies).toBe(1);
  expect(world.activity).toHaveLength(1);
});

it("rolls back records and the operation key if the history boundary fails", async () => {
  vi.spyOn(TaskRepository.prototype, "insertHistory").mockRejectedValue(
    new Error("Synthetic history failure"),
  );
  const before = world.changes();
  await expect(world.call("manager", "ticket.delete")).rejects.toThrow(
    "Synthetic history failure",
  );
  expect(world.changes()).toEqual(before);
  expect(world.tickets.get("root")?.archivedAt).toBeNull();
});

it("keeps the existing nonrecursive UI archive option", async () => {
  world.addTicket("root", { type: "epic" });
  world.addTicket("child", { parentId: "root" });
  vi.spyOn(TaskRepository.prototype, "detachChildren").mockImplementation(
    async () => {
      world.addTicket("child", { parentId: null });
      return ["child"];
    },
  );
  const context = world.ui("manager");
  await expect(
    context.tasks.archive(context.actor, "root", "keep"),
  ).resolves.toBe(1);
  expect(world.tickets.get("child")).toMatchObject({
    parentId: null,
    archivedAt: null,
  });
  expect(world.history.map((entry) => entry.action)).toEqual([
    "parent_changed",
    "archived",
  ]);
});
