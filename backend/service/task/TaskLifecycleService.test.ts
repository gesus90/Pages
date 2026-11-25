import { expect, it, vi } from "vitest";

import {
  WorkItemAccessDeniedError,
  WorkItemHierarchyError,
  WorkItemValidationError,
} from "@/backend/error/WorkItemErrors";

import { TaskLifecycleService } from "./TaskLifecycleService";

import { ROLE } from "@/definition/Role";

import type { ServerCache } from "@/backend/cache/ServerCache";
import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { TaskAccessGuard } from "./TaskAccessGuard";
import type { TaskHistoryRecorder } from "./TaskHistoryRecorder";
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
  readonly item?: object;
  readonly canDelete?: boolean;
  readonly hiddenDescendants?: boolean;
  readonly archived?: readonly string[];
  readonly restored?: readonly string[];
  readonly parentReference?: object | null;
  readonly parent?: object | null;
}

function epic(patch: object = {}): object {
  return {
    id: "t",
    key: "P-1",
    parentId: null,
    projectId: "p",
    type: "epic",
    ...patch,
  };
}

function setup(facts: Facts = {}): {
  readonly service: TaskLifecycleService;
  readonly repository: Record<string, Mock>;
  readonly history: Record<string, Mock>;
  readonly cache: Record<string, Mock>;
} {
  const item = facts.item ?? epic();
  const repository: Record<string, Mock> = {
    archiveMany: vi.fn(async (ids: string[]) => facts.archived ?? ids),
    countDescendants: vi.fn(async () => [
      { count: 2, isActive: true, type: "task" },
      { count: 1, isActive: false, type: "task" },
      { count: 5, isActive: true, type: "unknown" },
    ]),
    deleteSubtree: vi.fn(async () => {}),
    detachChildren: vi.fn(async () => ["c1", "c2"]),
    findById: vi.fn(async () =>
      facts.parent === undefined ? { archivedAt: null } : facts.parent,
    ),
    findParentReference: vi.fn(async () => facts.parentReference ?? null),
    findSubtreeIds: vi.fn(async (ignoredId: string, visibility?: unknown) =>
      visibility && facts.hiddenDescendants ? ["t"] : ["t", "c"],
    ),
    findSubtreeStorageNames: vi.fn(async () => ["file"]),
    restoreMany: vi.fn(async (ids: string[]) => facts.restored ?? ids),
  };
  const history: Record<string, Mock> = {
    recordArchived: vi.fn(async () => {}),
    recordParentChanged: vi.fn(async () => {}),
    recordRestored: vi.fn(async () => {}),
  };
  const cache: Record<string, Mock> = {
    invalidateGitHub: vi.fn(),
    invalidateLabels: vi.fn(),
    invalidateWorkItems: vi.fn(),
  };
  const access = doubleOf<TaskAccessGuard>({
    canArchive: vi.fn(async () => true),
    canDelete: vi.fn(async () => facts.canDelete ?? true),
    requireArchivableWorkItem: vi.fn(async () => item),
    requireWritableWorkItem: vi.fn(async () => item),
    requireWorkItem: vi.fn(async () => item),
    visibility: vi.fn(async () => ({ departmentIds: ["d"] })),
  });

  return {
    cache,
    history,
    repository,
    service: new TaskLifecycleService(
      doubleOf<TaskRepository>(repository),
      access,
      doubleOf<TaskHistoryRecorder>(history),
      doubleOf<ServerCache>(cache),
    ),
  };
}

it("describes the descendants with active and all counts", async () => {
  await expect(
    setup().service.describeDescendants(actor, "t"),
  ).resolves.toEqual({
    active: { epic: 0, initiative: 0, subtask: 0, task: 2 },
    all: { epic: 0, initiative: 0, subtask: 0, task: 3 },
    canArchive: true,
  });
});

it("archives a subtree and records every ticket", async () => {
  const { cache, history, service } = setup();

  await expect(service.archive(actor, "t")).resolves.toBe(2);

  expect(history.recordArchived).toHaveBeenCalledTimes(2);
  expect(cache.invalidateWorkItems).toHaveBeenCalledTimes(1);
});

it("archives only the item and releases the active children", async () => {
  const { history, repository, service } = setup();

  await expect(service.archiveWithImpact(actor, "t", "keep")).resolves.toEqual({
    changedCount: 1,
    parentId: null,
    ticketIds: ["t", "c1", "c2"],
  });
  expect(repository.archiveMany).toHaveBeenCalledWith(["t"]);
  expect(repository.detachChildren).toHaveBeenCalledWith("t", "active");
  expect(history.recordParentChanged).toHaveBeenCalledTimes(2);
});

it("does not touch the cache when nothing was archived", async () => {
  const { cache, service } = setup({ archived: [] });

  await expect(service.archive(actor, "t")).resolves.toBe(0);
  expect(cache.invalidateWorkItems).not.toHaveBeenCalled();
});

it("refuses to change a subtree with hidden descendants", async () => {
  const { service } = setup({ hiddenDescendants: true });

  await expect(service.archive(actor, "t")).rejects.toMatchObject({
    code: "descendantsHidden",
  });
});

it("keeps subtasks with their task", async () => {
  const { service } = setup({ item: epic({ type: "task" }) });

  await expect(service.archive(actor, "t", "keep")).rejects.toThrow(
    WorkItemValidationError,
  );
});

it("restores a subtree below an active parent", async () => {
  const { cache, history, service } = setup({
    item: epic({ parentId: "pp" }),
  });

  await service.restore(actor, "t");

  expect(history.recordRestored).toHaveBeenCalledTimes(2);
  expect(cache.invalidateWorkItems).toHaveBeenCalledTimes(1);
});

it("restores nothing without touching the cache", async () => {
  const { cache, service } = setup({ restored: [] });

  await expect(service.restoreWithImpact(actor, "t")).resolves.toEqual({
    changedCount: 0,
    parentId: null,
    ticketIds: [],
  });
  expect(cache.invalidateWorkItems).not.toHaveBeenCalled();
});

it("refuses to restore below an archived parent", async () => {
  const { service } = setup({
    item: epic({ parentId: "pp" }),
    parent: { archivedAt: "x" },
  });

  await expect(service.restore(actor, "t")).rejects.toThrow(
    WorkItemHierarchyError,
  );
});

it("finds the parent of a hidden reference and tolerates a missing one", async () => {
  const archived = setup({
    parent: { archivedAt: "x" },
    parentReference: { id: "pp" },
  });

  await expect(archived.service.restore(actor, "t")).rejects.toThrow(
    WorkItemHierarchyError,
  );

  const gone = setup({ parent: null, parentReference: { id: "pp" } });

  await expect(gone.service.restore(actor, "t")).resolves.toBeUndefined();
});

it("deletes a subtree permanently and returns its files", async () => {
  const { cache, repository, service } = setup();

  await expect(service.deletePermanently(actor, "t")).resolves.toEqual([
    "file",
  ]);

  expect(repository.deleteSubtree).toHaveBeenCalledWith("t");
  expect(cache.invalidateGitHub).toHaveBeenCalledTimes(1);
  expect(cache.invalidateLabels).toHaveBeenCalledTimes(1);
});

it("releases all children before a deletion that keeps them", async () => {
  const { repository, service } = setup();

  await service.deletePermanently(actor, "t", "keep");

  expect(repository.detachChildren).toHaveBeenCalledWith("t", "all");
});

it("refuses a deletion without administrator mode", async () => {
  const { service } = setup({ canDelete: false });

  await expect(service.deletePermanently(actor, "t")).rejects.toThrow(
    WorkItemAccessDeniedError,
  );
});
