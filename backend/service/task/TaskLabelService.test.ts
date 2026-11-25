import { expect, it, vi } from "vitest";

import { WorkItemValidationError } from "@/backend/error/WorkItemErrors";

import { TaskLabelService } from "./TaskLabelService";

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

const label = { color: "#aabbcc", id: "l1", name: "Bug" };

type Mock = ReturnType<typeof vi.fn>;

function doubleOf<Type extends object>(members: object): Type {
  return members as Type;
}

interface Facts {
  readonly cached?: unknown;
  readonly label?: object | null;
  readonly existing?: object | null;
  readonly assigned?: boolean;
}

function setup(facts: Facts = {}): {
  readonly service: TaskLabelService;
  readonly repository: Record<string, Mock>;
  readonly history: Record<string, Mock>;
  readonly cache: Record<string, Mock>;
} {
  const repository: Record<string, Mock> = {
    assignLabel: vi.fn(async () => facts.assigned ?? true),
    countLabelUsageByLabel: vi.fn(async () => new Map([["l1", 2]])),
    deleteLabel: vi.fn(async () => {}),
    findLabelById: vi.fn(async () =>
      facts.label === undefined ? label : facts.label,
    ),
    findLabelByName: vi.fn(async () => facts.existing ?? null),
    findLabels: vi.fn(async () => [label]),
    findLabelsForWorkItemIds: vi.fn(async () => new Map()),
    insertLabel: vi.fn(async () => {}),
    unassignLabel: vi.fn(async () => facts.assigned ?? true),
    updateLabel: vi.fn(async () => {}),
  };
  const history: Record<string, Mock> = {
    recordLabelAdded: vi.fn(async () => {}),
    recordLabelRemoved: vi.fn(async () => {}),
  };
  const cache: Record<string, Mock> = {
    get: vi.fn(() => facts.cached),
    invalidateLabels: vi.fn(),
    set: vi.fn(),
  };
  const access = doubleOf<TaskAccessGuard>({
    requireCapability: vi.fn(async () => {}),
    requireWritableWorkItem: vi.fn(async () => {}),
    visibility: vi.fn(async () => ({ departmentIds: null })),
  });

  return {
    cache,
    history,
    repository,
    service: new TaskLabelService(
      doubleOf<TaskRepository>(repository),
      access,
      doubleOf<TaskHistoryRecorder>(history),
      doubleOf<ServerCache>(cache),
    ),
  };
}

it("loads the catalog and caches it", async () => {
  const { cache, service } = setup();

  await expect(service.findLabels()).resolves.toEqual([label]);
  expect(cache.set).toHaveBeenCalledTimes(1);
});

it("serves the catalog, usage and item labels from the cache", async () => {
  const { repository, service } = setup({ cached: "cached" });

  await expect(service.findLabels()).resolves.toBe("cached");
  await expect(service.countLabelUsage(actor)).resolves.toBe("cached");
  await expect(service.findLabelsForWorkItems(["a"])).resolves.toBe("cached");
  expect(repository.findLabels).not.toHaveBeenCalled();
});

it("counts the usage and resolves labels of work items", async () => {
  const { cache, service } = setup();

  await expect(service.countLabelUsage(actor)).resolves.toEqual(
    new Map([["l1", 2]]),
  );
  await expect(service.findLabelsForWorkItems(["a"])).resolves.toEqual(
    new Map(),
  );
  expect(cache.set).toHaveBeenCalledTimes(2);
});

it("creates a label with trimmed name and normalized color", async () => {
  const { cache, repository, service } = setup();

  await expect(
    service.createLabel(actor, { color: "#ABC", name: "  Bug  " }),
  ).resolves.toEqual(label);
  expect(repository.insertLabel).toHaveBeenCalledWith(
    expect.objectContaining({ color: "#aabbcc", name: "Bug" }),
  );
  expect(cache.invalidateLabels).toHaveBeenCalledTimes(1);
});

it("rejects invalid label input", async () => {
  const { service } = setup();

  await expect(
    service.createLabel(actor, { color: "#abc", name: "  " }),
  ).rejects.toMatchObject({ code: "labelNameLength" });
  await expect(
    service.createLabel(actor, { color: "red", name: "x" }),
  ).rejects.toMatchObject({ code: "labelColorUnsupported" });
});

it("rejects a taken name", async () => {
  const { service } = setup({ existing: { id: "other" } });

  await expect(
    service.createLabel(actor, { color: "#abc", name: "Bug" }),
  ).rejects.toThrow(WorkItemValidationError);
});

it("fails when a created label cannot be read back", async () => {
  const { service } = setup({ label: null });

  await expect(
    service.createLabel(actor, { color: "#abc", name: "Bug" }),
  ).rejects.toThrow("Created label could not be retrieved.");
});

it("updates a label and allows its own name", async () => {
  const { repository, service } = setup({ existing: label });

  await expect(
    service.updateLabel(actor, "l1", { color: "#abc", name: "Bug" }),
  ).resolves.toEqual(label);
  expect(repository.updateLabel).toHaveBeenCalledTimes(1);
});

it("rejects the update of an unknown label", async () => {
  const { service } = setup({ label: null });

  await expect(
    service.updateLabel(actor, "l1", { color: "#abc", name: "Bug" }),
  ).rejects.toMatchObject({ code: "labelNotFound" });
});

it("fails when an updated label cannot be read back", async () => {
  const { repository, service } = setup();
  repository.findLabelById
    .mockResolvedValueOnce(label)
    .mockResolvedValueOnce(null);

  await expect(
    service.updateLabel(actor, "l1", { color: "#abc", name: "Bug" }),
  ).rejects.toThrow("Updated label could not be retrieved.");
});

it("deletes a label", async () => {
  const { cache, repository, service } = setup();

  await service.deleteLabel(actor, "l1");

  expect(repository.deleteLabel).toHaveBeenCalledWith("l1");
  expect(cache.invalidateLabels).toHaveBeenCalledTimes(1);
});

it("assigns a label and records it once", async () => {
  const { history, service } = setup();

  await service.assignLabel(actor, "w", "l1");

  expect(history.recordLabelAdded).toHaveBeenCalledWith(actor, "w", "Bug");
});

it("does not record a label that was assigned before", async () => {
  const { history, service } = setup({ assigned: false });

  await service.assignLabel(actor, "w", "l1");

  expect(history.recordLabelAdded).not.toHaveBeenCalled();
});

it("rejects the assignment of an unknown label", async () => {
  const { service } = setup({ label: null });

  await expect(service.assignLabel(actor, "w", "l1")).rejects.toMatchObject({
    code: "labelNotFound",
  });
});

it("unassigns a label and records its name", async () => {
  const { history, service } = setup();

  await service.unassignLabel(actor, "w", "l1");

  expect(history.recordLabelRemoved).toHaveBeenCalledWith(actor, "w", "Bug");
});

it("records a removed label without a known name", async () => {
  const { history, service } = setup({ label: null });

  await service.unassignLabel(actor, "w", "l1");

  expect(history.recordLabelRemoved).toHaveBeenCalledWith(actor, "w", null);
});

it("does not record the removal of a label that was not assigned", async () => {
  const { history, service } = setup({ assigned: false });

  await service.unassignLabel(actor, "w", "l1");

  expect(history.recordLabelRemoved).not.toHaveBeenCalled();
});
