import { expect, it, vi } from "vitest";

import { PermissionService } from "@/backend/auth/PermissionService";
import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { AnnouncingTaskService } from "@/backend/service/AnnouncingTaskService";
import { AgentTicketAnnouncer } from "@/backend/service/agents/AgentTicketAnnouncer";
import { ProjectService } from "@/backend/service/ProjectService";
import { TaskService } from "@/backend/service/TaskService";

import { DiscordWorld, ticketFacts } from "./discord-world";

import type { PagesEvent } from "@/backend/service/events/PagesEventPublisher";
import type { WorkItemChecklistItem, WorkItemDetail } from "@/definition/Task";
import type { User } from "@/definition/User";

function createStub<Instance extends object>(type: {
  readonly prototype: Instance;
}): Instance {
  return Object.create(type.prototype);
}

function createService(events: PagesEvent[]): AnnouncingTaskService {
  return new AnnouncingTaskService(
    {
      permissionService: createStub(PermissionService),
      projectService: createStub(ProjectService),
      taskRepository: createStub(TaskRepository),
    },
    { publish: (event) => events.push(event) },
  );
}

const ACTOR: User = {
  displayName: "Actor",
  id: "actor",
  isActive: true,
  mustChangePassword: false,
  role: "manager",
  username: "actor",
};

function detail(id: string, statusId = "todo"): WorkItemDetail {
  return JSON.parse(JSON.stringify({ id, statusId })) as WorkItemDetail;
}

function checklistItem(workItemId: string): WorkItemChecklistItem {
  return {
    createdAt: "",
    id: "c1",
    isDone: true,
    sortOrder: 0,
    title: "Item",
    updatedAt: "",
    workItemId,
  };
}

it("announces a created ticket and a created milestone after the change is stored", async () => {
  const events: PagesEvent[] = [];
  const service = createService(events);

  vi.spyOn(TaskService.prototype, "create").mockResolvedValue(detail("t1"));
  vi.spyOn(TaskService.prototype, "createMilestone").mockResolvedValue(
    JSON.parse('{"id":"m1"}'),
  );

  await service.create(ACTOR, JSON.parse("{}"));
  await service.createMilestone(ACTOR, JSON.parse("{}"));

  expect(events).toEqual([
    { id: "t1", type: "ticket.created" },
    { id: "m1", type: "milestone.created" },
  ]);
});

it("announces the changes of a ticket", async () => {
  const events: PagesEvent[] = [];
  const service = createService(events);
  const result = detail("t1");
  const proto = TaskService.prototype;

  vi.spyOn(proto, "update").mockResolvedValue(result);
  vi.spyOn(proto, "updateDescription").mockResolvedValue(result);
  vi.spyOn(proto, "changeParent").mockResolvedValue(result);
  vi.spyOn(proto, "updateTitle").mockResolvedValue(result);
  vi.spyOn(proto, "updateStatus").mockResolvedValue(result);
  vi.spyOn(proto, "updateParent").mockResolvedValue(result);
  vi.spyOn(proto, "moveToProject").mockResolvedValue(result);
  vi.spyOn(proto, "setDepartment").mockResolvedValue();
  vi.spyOn(proto, "assignLabel").mockResolvedValue();
  vi.spyOn(proto, "unassignLabel").mockResolvedValue();
  vi.spyOn(proto, "addChecklistItem").mockResolvedValue(checklistItem("t1"));
  vi.spyOn(proto, "setChecklistItemDone").mockResolvedValue(
    checklistItem("t1"),
  );
  vi.spyOn(proto, "addLink").mockResolvedValue([]);
  vi.spyOn(proto, "removeLink").mockResolvedValue([]);

  await service.update(ACTOR, "t1", JSON.parse("{}"));
  await service.updateDescription(ACTOR, "t1", {
    baseDescription: "",
    description: "x",
  });
  await service.changeParent(ACTOR, "t1", null);
  await service.updateTitle(ACTOR, "t1", { baseTitle: "a", title: "b" });
  await service.updateStatus(ACTOR, "t1", { baseStatusId: "a", statusId: "b" });
  await service.updateParent(ACTOR, "t1", {
    baseParentId: null,
    parentId: "p",
  });
  await service.moveToProject(ACTOR, "t1", "p2");
  await service.setDepartment(ACTOR, "t1", null);
  await service.assignLabel(ACTOR, "t1", "l1");
  await service.unassignLabel(ACTOR, "t1", "l1");
  await service.addChecklistItem(ACTOR, "t1", "Item");
  await service.setChecklistItemDone(ACTOR, "c1", true);
  await service.addLink(ACTOR, "t1", "PAGE-2", "relates_to");
  await service.removeLink(ACTOR, "t1", "link");

  expect(events).toHaveLength(14);
  expect(
    events.every(
      (event) => event.type === "ticket.updated" && event.id === "t1",
    ),
  ).toBe(true);
});

it("announces the changes of a milestone and of its dependencies", async () => {
  const events: PagesEvent[] = [];
  const service = createService(events);
  const proto = TaskService.prototype;

  vi.spyOn(proto, "updateMilestone").mockResolvedValue(
    JSON.parse('{"id":"m1"}'),
  );
  vi.spyOn(proto, "updateMilestoneField").mockResolvedValue(
    JSON.parse('{"isChanged":true}'),
  );
  vi.spyOn(proto, "addDependency").mockResolvedValue(
    JSON.parse('{"sourceId":"m2"}'),
  );

  await service.updateMilestone(ACTOR, "m1", JSON.parse("{}"));
  await service.updateMilestoneField(ACTOR, "m1", JSON.parse("{}"));
  await service.addDependency(ACTOR, JSON.parse("{}"));

  expect(events).toEqual([
    { id: "m1", type: "milestone.updated" },
    { id: "m1", type: "milestone.updated" },
    { id: "m2", type: "milestone.updated" },
  ]);
});

it("announces nothing for a change that was refused or rolled back", async () => {
  const events: PagesEvent[] = [];
  const service = createService(events);

  vi.spyOn(TaskService.prototype, "create").mockRejectedValue(
    new Error("denied"),
  );
  vi.spyOn(TaskService.prototype, "update").mockRejectedValue(
    new Error("conflict"),
  );
  vi.spyOn(TaskService.prototype, "createMilestone").mockRejectedValue(
    new Error("denied"),
  );
  vi.spyOn(TaskService.prototype, "assignLabel").mockRejectedValue(
    new Error("gone"),
  );

  await expect(service.create(ACTOR, JSON.parse("{}"))).rejects.toThrow(
    "denied",
  );
  await expect(service.update(ACTOR, "t1", JSON.parse("{}"))).rejects.toThrow(
    "conflict",
  );
  await expect(
    service.createMilestone(ACTOR, JSON.parse("{}")),
  ).rejects.toThrow("denied");
  await expect(service.assignLabel(ACTOR, "t1", "l1")).rejects.toThrow("gone");

  expect(events).toEqual([]);
});

it("announces nothing for a change that wrote nothing", async () => {
  const events: PagesEvent[] = [];
  const service = createService(events);
  const proto = TaskService.prototype;

  vi.spyOn(proto, "updateStatus").mockResolvedValue(detail("t1"));
  vi.spyOn(proto, "updateMilestoneField").mockResolvedValue(
    JSON.parse('{"isChanged":false}'),
  );
  vi.spyOn(proto, "deleteChecklistItem").mockResolvedValue();
  vi.spyOn(proto, "getById").mockResolvedValue(detail("t1", "todo"));
  vi.spyOn(proto, "updateStatusAndOrder").mockResolvedValue(
    detail("t1", "todo"),
  );

  await service.updateStatus(ACTOR, "t1", {
    baseStatusId: "todo",
    statusId: "todo",
  });
  await service.updateMilestoneField(ACTOR, "m1", JSON.parse("{}"));
  await service.deleteChecklistItem(ACTOR, "c1");
  // Moving a card inside its column changes no field a message states.
  await service.updateStatusAndOrder(ACTOR, "t1", "todo", 3);

  expect(events).toEqual([]);

  vi.spyOn(proto, "updateStatusAndOrder").mockResolvedValue(
    detail("t1", "done"),
  );
  await service.updateStatusAndOrder(ACTOR, "t1", "done", 0);

  expect(events).toEqual([{ id: "t1", type: "ticket.updated" }]);
});

it("turns a change made in the interface into a Discord message", async () => {
  const world = new DiscordWorld();

  await world.connectAlpha();
  world.tickets.set("t1", ticketFacts({ title: "Made in the UI" }));
  world.notifications.listen(world.publisher);

  const service = new AnnouncingTaskService(
    {
      permissionService: createStub(PermissionService),
      projectService: createStub(ProjectService),
      taskRepository: createStub(TaskRepository),
    },
    world.publisher,
  );

  vi.spyOn(TaskService.prototype, "create").mockResolvedValue(detail("t1"));
  await service.create(ACTOR, JSON.parse("{}"));
  await vi.waitFor(() => {
    expect(world.deliveries.rows.size).toBe(1);
  });
  await world.worker.runDue();

  expect(world.discord.messages).toHaveLength(1);
  expect(world.discord.messages[0]?.content).toContain("Made in the UI");
  expect(world.discord.messages[0]?.content).toContain("**Ticket created**");
});

it("turns a committed change made by an agent into a Discord message, once", async () => {
  const world = new DiscordWorld();

  await world.connectAlpha();
  world.tickets.set("t1", ticketFacts({ title: "Made by an agent" }));
  world.notifications.listen(world.publisher);

  const announcer = new AgentTicketAnnouncer({
    cache: { invalidateWorkItems: () => undefined },
    events: world.publisher,
    publisher: null,
  });
  const completed = {
    actor: ACTOR,
    event: { id: "t1", type: "ticket.updated" },
    published: null,
    result: undefined,
  } as const;

  announcer.announce(completed);
  // A repeated call with the same operation id wrote nothing and announces nothing.
  announcer.announce({ ...completed, event: null });

  await vi.waitFor(() => {
    expect(world.deliveries.rows.size).toBe(1);
  });
  await world.worker.runDue();

  expect(world.discord.messages).toHaveLength(1);
  expect(world.discord.messages[0]?.content).toContain("Made by an agent");
  expect(world.discord.messages[0]?.content).toContain("**Ticket updated**");
});

it("announces the removal of a dependency for its source and the link of an initiative", async () => {
  const events: PagesEvent[] = [];
  const service = createService(events);
  const proto = TaskService.prototype;

  vi.spyOn(proto, "findDependencies").mockResolvedValue(
    JSON.parse('[{"id":"dep1","sourceId":"m2"},{"id":"dep2","sourceId":"m3"}]'),
  );
  vi.spyOn(proto, "removeDependency").mockResolvedValue();
  vi.spyOn(proto, "linkInitiativeToMilestone").mockResolvedValue(
    JSON.parse("{}"),
  );
  vi.spyOn(proto, "unlinkInitiativeFromMilestone").mockResolvedValue(
    JSON.parse("{}"),
  );

  await service.removeDependency(ACTOR, "alpha", "dep1");
  await service.linkInitiativeToMilestone(ACTOR, "m1", "i1");
  await service.unlinkInitiativeFromMilestone(ACTOR, "m1", "i1");

  expect(events).toEqual([
    { id: "m2", type: "milestone.updated" },
    { id: "m1", type: "milestone.updated" },
    { id: "m1", type: "milestone.updated" },
  ]);
});

it("announces nothing when the removed dependency is unknown or the removal fails", async () => {
  const events: PagesEvent[] = [];
  const service = createService(events);
  const proto = TaskService.prototype;

  vi.spyOn(proto, "findDependencies").mockResolvedValue([]);
  vi.spyOn(proto, "removeDependency").mockResolvedValueOnce();
  await service.removeDependency(ACTOR, "alpha", "gone");

  vi.spyOn(proto, "findDependencies").mockRejectedValue(new Error("denied"));
  vi.spyOn(proto, "removeDependency").mockRejectedValue(new Error("denied"));
  await expect(
    service.removeDependency(ACTOR, "alpha", "dep1"),
  ).rejects.toThrow("denied");

  expect(events).toEqual([]);
});
