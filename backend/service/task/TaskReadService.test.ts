import { expect, it, vi } from "vitest";

import { WorkItemNotFoundError } from "@/backend/error/WorkItemErrors";

import { TaskReadService } from "./TaskReadService";

import { ROLE } from "@/definition/Role";

import type { ServerCache } from "@/backend/cache/ServerCache";
import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { TaskAccessGuard } from "./TaskAccessGuard";
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

interface Facts {
  readonly cached?: unknown;
  readonly projectIds?: readonly string[];
  readonly archivable?: readonly string[];
  readonly byKey?: object | null;
  readonly history?: readonly object[];
}

function setup(facts: Facts = {}): {
  readonly service: TaskReadService;
  readonly repository: Record<string, Mock>;
  readonly access: Record<string, Mock>;
  readonly cache: Record<string, Mock>;
} {
  const repository: Record<string, Mock> = {
    countWorkItemsByProject: vi.fn(async () => new Map()),
    countWorkItemsOverview: vi.fn(async () => ({ total: 1 })),
    findAll: vi.fn(async () => [{ id: "w" }]),
    findAllStatuses: vi.fn(async () => [
      { id: "s1", projectId: null },
      { id: "s2", projectId: "p1" },
      { id: "s3", projectId: "p9" },
    ]),
    findByKey: vi.fn(async () =>
      facts.byKey === undefined ? { projectId: "p1" } : facts.byKey,
    ),
    findEligibleAssignees: vi.fn(async () => [{ id: "a" }]),
    findEligibleAssigneesByProjectIds: vi.fn(async () => new Map()),
    findHistoryByProjectId: vi.fn(async () => facts.history ?? []),
    findHistoryByWorkItemId: vi.fn(async () => facts.history ?? []),
    findSubtasks: vi.fn(async () => [{ id: "c" }]),
    findVisibleKeys: vi.fn(async () => new Set(["K-1"])),
  };
  const access: Record<string, Mock> = {
    archivableProjectIds: vi.fn(async () => facts.archivable ?? []),
    filterAssignees: vi.fn(async (input: Map<string, unknown>) => input),
    requireProject: vi.fn(async () => ({})),
    requireWorkItem: vi.fn(async () => ({ id: "w" })),
    visibility: vi.fn(async () => ({
      departmentIds: null,
      projectIds: facts.projectIds ?? ["p1", "p2"],
    })),
  };
  const cache: Record<string, Mock> = {
    get: vi.fn(() => facts.cached),
    set: vi.fn(),
  };

  return {
    access,
    cache,
    repository,
    service: new TaskReadService(
      doubleOf<TaskRepository>(repository),
      doubleOf<TaskAccessGuard>(access),
      doubleOf<ServerCache>(cache),
    ),
  };
}

const scope = {
  todayDate: "d",
  userId: "x",
  weekAgoStart: "w",
  yesterdayDate: "y",
};

it("filters the statuses by project access, cached or not", async () => {
  const fresh = setup();
  const cached = setup({
    cached: [
      { id: "s1", projectId: null },
      { id: "s3", projectId: "p9" },
    ],
  });

  await expect(fresh.service.findAllStatuses(actor)).resolves.toEqual([
    { id: "s1", projectId: null },
    { id: "s2", projectId: "p1" },
  ]);
  expect(fresh.cache.set).toHaveBeenCalledTimes(1);
  await expect(cached.service.findAllStatuses(actor)).resolves.toEqual([
    { id: "s1", projectId: null },
  ]);
});

it("returns the history of a project with redacted parent keys", async () => {
  const { service } = setup({
    history: [
      { field: "title", newValue: "n", oldValue: "o" },
      { field: "parent", newValue: "K-2", oldValue: "K-1" },
      { field: "parent", newValue: null, oldValue: null },
    ],
  });

  await expect(service.findHistoryByProject(actor, "p1")).resolves.toEqual([
    { field: "title", newValue: "n", oldValue: "o" },
    { field: "parent", newValue: null, oldValue: "K-1" },
    { field: "parent", newValue: null, oldValue: null },
  ]);
});

it("returns the history of a work item", async () => {
  const { service } = setup({ history: [{ field: "title" }] });

  await expect(service.getHistory(actor, "w")).resolves.toEqual([
    { field: "title" },
  ]);
});

it("lists the eligible assignees of a project", async () => {
  const { access, service } = setup();

  access.filterAssignees.mockResolvedValueOnce(new Map());

  await expect(service.findEligibleAssignees(actor, "p1")).resolves.toEqual([]);

  await expect(service.findEligibleAssignees(actor, "p1")).resolves.toEqual([
    { id: "a" },
  ]);
});

it("lists assignees of several projects from the cache or the database", async () => {
  const fresh = setup();
  const cached = setup({ cached: new Map([["p1", []]]) });

  await fresh.service.findAssigneesByProjects(["p1"]);
  await cached.service.findAssigneesByProjects(["p1"]);

  expect(fresh.cache.set).toHaveBeenCalledTimes(1);
  expect(
    cached.repository.findEligibleAssigneesByProjectIds,
  ).not.toHaveBeenCalled();
  expect(cached.access.filterAssignees).toHaveBeenCalledTimes(1);
});

it("returns no items without effective projects", async () => {
  const { repository, service } = setup({ projectIds: [] });

  await expect(service.findAll(actor)).resolves.toEqual([]);
  await expect(
    setup().service.findAll(actor, { projectIds: ["other"] }),
  ).resolves.toEqual([]);
  expect(repository.findAll).not.toHaveBeenCalled();
});

it("returns no items when the scope has no project list", async () => {
  const { access, service } = setup();
  access.visibility.mockResolvedValue({ departmentIds: null });

  await expect(service.findAll(actor)).resolves.toEqual([]);
});

it("finds active items of the requested projects and caches them", async () => {
  const { cache, repository, service } = setup();

  await expect(service.findAll(actor, { projectIds: ["p2"] })).resolves.toEqual(
    [{ id: "w" }],
  );
  expect(repository.findAll).toHaveBeenCalledWith(
    expect.objectContaining({ projectIds: ["p2"] }),
  );
  expect(cache.set).toHaveBeenCalledTimes(1);
});

it("serves item queries from the cache", async () => {
  const { repository, service } = setup({ cached: [{ id: "cached" }] });

  await expect(service.findAll(actor, { search: " Foo " })).resolves.toEqual([
    { id: "cached" },
  ]);
  expect(repository.findAll).not.toHaveBeenCalled();
});

it("limits archived items to archivable projects", async () => {
  const archivable = setup({ archivable: ["p1"] });
  const none = setup();
  const noneAll = setup();
  const noneOnly = setup();

  await archivable.service.findAll(actor, { archived: "archived" });
  await none.service.findAll(actor, { archived: "all" });
  await expect(
    noneOnly.service.findAll(actor, { archived: "archived" }),
  ).resolves.toEqual([]);
  await noneAll.service.findAll(actor, { archived: "all" });

  expect(archivable.repository.findAll).toHaveBeenCalledWith(
    expect.objectContaining({ archivedProjectIds: ["p1"] }),
  );
  expect(none.repository.findAll).toHaveBeenCalledWith(
    expect.objectContaining({ archived: "active" }),
  );
});

it("gets items by id and key", async () => {
  const { service } = setup();

  await expect(service.getById(actor, "w")).resolves.toEqual({ id: "w" });
  await expect(service.getByKey(actor, "K-1")).resolves.toEqual({
    projectId: "p1",
  });
  await expect(
    setup({ byKey: null }).service.getByKey(actor, "K-1"),
  ).rejects.toThrow(WorkItemNotFoundError);
});

it("finds the subtasks of a parent", async () => {
  await expect(setup().service.findSubtasks(actor, "w")).resolves.toEqual([
    { id: "c" },
  ]);
});

it("counts overview and project counters for the actor scope", async () => {
  const { repository, service } = setup();

  await expect(
    service.countWorkItemsOverview(actor, ["p1"], scope),
  ).resolves.toEqual({ total: 1 });
  await expect(service.countWorkItemsByProject(actor, ["p1"])).resolves.toEqual(
    new Map(),
  );
  expect(repository.countWorkItemsOverview).toHaveBeenCalledWith(
    ["p1"],
    { ...scope, userId: "u" },
    expect.anything(),
  );
});
