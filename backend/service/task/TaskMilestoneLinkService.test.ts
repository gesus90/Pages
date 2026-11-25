import { expect, it, vi } from "vitest";

import { TaskMilestoneLinkService } from "./TaskMilestoneLinkService";

import { ROLE } from "@/definition/Role";

import type { ServerCache } from "@/backend/cache/ServerCache";
import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { TaskAccessGuard } from "./TaskAccessGuard";
import type { TaskHistoryRecorder } from "./TaskHistoryRecorder";
import type { WorkItemDetail } from "@/definition/Task";
import type { User } from "@/definition/User";

const actor: User = {
  displayName: "U",
  id: "u",
  isActive: true,
  mustChangePassword: false,
  role: ROLE.EMPLOYEE,
  username: "u",
};

type Mock = ReturnType<typeof vi.fn>;

function doubleOf<Type extends object>(members: object): Type {
  return members as Type;
}

function item(patch: object = {}): object {
  return {
    archivedAt: null,
    id: "i",
    milestoneId: null,
    parentId: null,
    projectId: "p",
    type: "initiative",
    ...patch,
  };
}

interface Facts {
  readonly accessible?: readonly string[];
  readonly initiative?: object;
  readonly milestone?: object | null;
  readonly links?: readonly object[];
  readonly dependents?: number;
  readonly byId?: Record<string, object | null>;
  readonly adopted?: boolean;
}

function setup(facts: Facts = {}): {
  readonly service: TaskMilestoneLinkService;
  readonly repository: Record<string, Mock>;
  readonly history: Record<string, Mock>;
  readonly cache: Record<string, Mock>;
} {
  const repository: Record<string, Mock> = {
    clearMilestone: vi.fn(async () => {}),
    countMilestoneDependents: vi.fn(async () => facts.dependents ?? 0),
    findAll: vi.fn(async () => [{ id: "i" }]),
    findById: vi.fn(async (id: string) => facts.byId?.[id] ?? null),
    findMilestoneById: vi.fn(async () =>
      facts.milestone === undefined
        ? { id: "m", name: "M1", projectId: "p" }
        : facts.milestone,
    ),
    findMilestoneInitiativeLinks: vi.fn(async () => facts.links ?? []),
    linkInitiativeToMilestone: vi.fn(async () => {}),
    setMilestoneIfEmpty: vi.fn(async () => facts.adopted ?? true),
    unlinkInitiativeFromMilestone: vi.fn(async () => {}),
  };
  const history: Record<string, Mock> = {
    recordMilestoneAdopted: vi.fn(async () => {}),
    recordMilestoneLinked: vi.fn(async () => {}),
    recordMilestoneUnlinked: vi.fn(async () => {}),
  };
  const cache: Record<string, Mock> = { invalidateWorkItems: vi.fn() };
  const access = doubleOf<TaskAccessGuard>({
    requireWritableWorkItem: vi.fn(async () => facts.initiative ?? item()),
    resolveAccessibleProjectIds: vi.fn(async () => facts.accessible ?? ["p"]),
    visibility: vi.fn(async () => ({ departmentIds: null })),
  });

  return {
    cache,
    history,
    repository,
    service: new TaskMilestoneLinkService(
      doubleOf<TaskRepository>(repository),
      access,
      doubleOf<TaskHistoryRecorder>(history),
      doubleOf<ServerCache>(cache),
    ),
  };
}

it("returns only links of visible initiatives", async () => {
  const { service } = setup({
    links: [
      { initiativeId: "i", milestoneId: "m" },
      { initiativeId: "hidden", milestoneId: "m" },
    ],
  });

  await expect(service.findLinks(actor, ["p"])).resolves.toEqual([
    { initiativeId: "i", milestoneId: "m" },
  ]);
});

it("returns no links without accessible projects", async () => {
  const { repository, service } = setup({ accessible: [] });

  await expect(service.findLinks(actor, ["p"])).resolves.toEqual([]);
  expect(repository.findAll).not.toHaveBeenCalled();
});

it("links an initiative with a milestone", async () => {
  const { cache, history, service } = setup();

  await expect(service.addInitiative(actor, "m", "i")).resolves.toEqual({
    initiativeId: "i",
    isChanged: true,
    milestoneId: "m",
    projectId: "p",
  });
  expect(cache.invalidateWorkItems).toHaveBeenCalledTimes(1);
  expect(history.recordMilestoneLinked).toHaveBeenCalledWith(actor, "i", "M1");
});

it("reports no change when the milestone is the own one or linked", async () => {
  const own = setup({ initiative: item({ milestoneId: "m" }) });
  const linked = setup({ links: [{ initiativeId: "i", milestoneId: "m" }] });
  const other = setup({ links: [{ initiativeId: "i", milestoneId: "x" }] });

  await expect(
    own.service.addInitiative(actor, "m", "i"),
  ).resolves.toMatchObject({ isChanged: false });
  await expect(
    linked.service.addInitiative(actor, "m", "i"),
  ).resolves.toMatchObject({ isChanged: false });
  await expect(
    other.service.addInitiative(actor, "m", "i"),
  ).resolves.toMatchObject({ isChanged: true });
});

it("rejects items that are no active initiative", async () => {
  await expect(
    setup({ initiative: item({ type: "epic" }) }).service.addInitiative(
      actor,
      "m",
      "i",
    ),
  ).rejects.toMatchObject({ code: "initiativeRequired" });
  await expect(
    setup({ initiative: item({ archivedAt: "x" }) }).service.addInitiative(
      actor,
      "m",
      "i",
    ),
  ).rejects.toMatchObject({ code: "ticketArchived" });
});

it("rejects a missing milestone or one of another project", async () => {
  await expect(
    setup({ milestone: null }).service.addInitiative(actor, "m", "i"),
  ).rejects.toMatchObject({ code: "milestoneNotFound" });
  await expect(
    setup({ milestone: { id: "m", projectId: "other" } }).service.addInitiative(
      actor,
      "m",
      "i",
    ),
  ).rejects.toMatchObject({ code: "milestoneOtherProject" });
});

it("removes the link of an initiative", async () => {
  const { history, repository, service } = setup({
    links: [{ initiativeId: "i", milestoneId: "m" }],
  });

  await expect(service.removeInitiative(actor, "m", "i")).resolves.toEqual({
    initiativeId: "i",
    isChanged: true,
    milestoneId: "m",
    projectId: "p",
  });
  expect(repository.unlinkInitiativeFromMilestone).toHaveBeenCalledWith(
    "m",
    "i",
  );
  expect(repository.clearMilestone).toHaveBeenCalledWith("i", "m");
  expect(history.recordMilestoneUnlinked).toHaveBeenCalledTimes(1);
});

it("reports no change when removing a link that does not exist", async () => {
  await expect(
    setup().service.removeInitiative(actor, "m", "i"),
  ).resolves.toMatchObject({ isChanged: false });
});

it("refuses to remove a link that is still in use", async () => {
  const { service } = setup({
    dependents: 1,
    links: [{ initiativeId: "i", milestoneId: "m" }],
  });

  await expect(service.removeInitiative(actor, "m", "i")).rejects.toMatchObject(
    {
      code: "milestoneInitiativeInUse",
    },
  );
});

function task(patch: object = {}): WorkItemDetail {
  return item({
    milestoneId: "m",
    parentId: "e",
    type: "task",
    ...patch,
  }) as WorkItemDetail;
}

it.each([
  ["a non task", { type: "epic" }],
  ["without milestone", { milestoneId: null }],
  ["without parent", { parentId: null }],
  ["archived", { archivedAt: "x" }],
])("does not thread a task %s", async (ignoredName, patch) => {
  const { repository, service } = setup();

  await service.threadAssignedTask(actor, task(patch));

  expect(repository.findMilestoneById).not.toHaveBeenCalled();
});

it("stops threading without milestone or epic", async () => {
  const noMilestone = setup({ milestone: null });
  const noEpic = setup({ byId: { e: { id: "e", type: "task" } } });

  await noMilestone.service.threadAssignedTask(actor, task());
  await noEpic.service.threadAssignedTask(actor, task());

  expect(noMilestone.repository.findById).not.toHaveBeenCalledWith("e2");
  expect(noEpic.repository.setMilestoneIfEmpty).not.toHaveBeenCalled();
});

it("threads the milestone to the epic and its initiative", async () => {
  const { history, repository, service } = setup({
    byId: {
      e: { id: "e", parentId: "i", type: "epic" },
      i: item(),
    },
  });

  await service.threadAssignedTask(actor, task());

  expect(history.recordMilestoneAdopted).toHaveBeenCalledWith(actor, "e", "M1");
  expect(repository.linkInitiativeToMilestone).toHaveBeenCalledWith("m", "i");
});

it("keeps the milestone an epic already has and skips other parents", async () => {
  const kept = setup({
    adopted: false,
    byId: {
      e: { id: "e", parentId: "i", type: "epic" },
      i: item({ type: "epic" }),
    },
  });
  const archived = setup({
    byId: {
      e: { id: "e", parentId: "i", type: "epic" },
      i: item({ archivedAt: "x" }),
    },
  });
  const orphan = setup({
    byId: { e: { id: "e", parentId: null, type: "epic" } },
  });

  await kept.service.threadAssignedTask(actor, task());
  await archived.service.threadAssignedTask(actor, task());
  await orphan.service.threadAssignedTask(actor, task());

  expect(kept.history.recordMilestoneAdopted).not.toHaveBeenCalled();
  expect(kept.repository.linkInitiativeToMilestone).not.toHaveBeenCalled();
  expect(archived.repository.linkInitiativeToMilestone).not.toHaveBeenCalled();
  expect(orphan.repository.linkInitiativeToMilestone).not.toHaveBeenCalled();
});
