import { expect, it, vi } from "vitest";

import {
  WorkItemConflictError,
  WorkItemValidationError,
} from "@/backend/error/WorkItemErrors";

import { TaskFieldService } from "./TaskFieldService";

import { ROLE } from "@/definition/Role";

import type { ServerCache } from "@/backend/cache/ServerCache";
import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { TaskAccessGuard } from "./TaskAccessGuard";
import type { TaskGitHubPublisher } from "./TaskGitHubPublisher";
import type { TaskHistoryRecorder } from "./TaskHistoryRecorder";
import type { WorkItemReferenceValidator } from "./WorkItemReferenceValidator";
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
  readonly existing?: object;
  readonly status?: object | null;
  readonly hiddenParent?: object | null;
  readonly updated?: boolean;
  readonly stored?: object | null;
}

function ticket(patch: object = {}): object {
  return {
    archivedAt: null,
    id: "t",
    parentId: "p1",
    parentKey: "P-1",
    projectId: "p",
    statusId: "s1",
    title: "Old",
    type: "task",
    ...patch,
  };
}

function setup(facts: Facts = {}): {
  readonly service: TaskFieldService;
  readonly repository: Record<string, Mock>;
  readonly history: Record<string, Mock>;
  readonly publisher: Record<string, Mock>;
  readonly validator: Record<string, Mock>;
  readonly cache: Record<string, Mock>;
} {
  const repository: Record<string, Mock> = {
    findById: vi.fn(async () =>
      facts.stored === undefined ? ticket({ title: "New" }) : facts.stored,
    ),
    findParentReference: vi.fn(async () => facts.hiddenParent ?? null),
    findStatusById: vi.fn(async () =>
      facts.status === undefined ? { id: "s2", projectId: null } : facts.status,
    ),
    replaceParent: vi.fn(async () => facts.updated ?? true),
    storedTextForm: vi.fn(async (text: string) => text.replace("\u0000", "")),
    updateStatus: vi.fn(async () => facts.updated ?? true),
    updateTitle: vi.fn(async () => facts.updated ?? true),
  };
  const history: Record<string, Mock> = {
    recordParentChanged: vi.fn(async () => {}),
    recordStatusMove: vi.fn(async () => {}),
    recordTitleChanged: vi.fn(async () => {}),
  };
  const publisher: Record<string, Mock> = { publish: vi.fn(async () => {}) };
  const validator: Record<string, Mock> = {
    validateHierarchy: vi.fn(async () => {}),
  };
  const cache: Record<string, Mock> = { invalidateWorkItems: vi.fn() };
  const access = doubleOf<TaskAccessGuard>({
    requireWritableWorkItem: vi.fn(async () => facts.existing ?? ticket()),
    visibility: vi.fn(async () => ({ departmentIds: null })),
  });

  return {
    cache,
    history,
    publisher,
    repository,
    service: new TaskFieldService({
      access,
      cache: doubleOf<ServerCache>(cache),
      gitHubPublisher: doubleOf<TaskGitHubPublisher>(publisher),
      history: doubleOf<TaskHistoryRecorder>(history),
      taskRepository: doubleOf<TaskRepository>(repository),
      validator: doubleOf<WorkItemReferenceValidator>(validator),
    }),
    validator,
  };
}

it("updates a title and publishes the stored ticket", async () => {
  const { cache, history, publisher, service } = setup();

  await expect(
    service.updateTitle(actor, "t", { baseTitle: "Old", title: " New " }),
  ).resolves.toMatchObject({ title: "New" });

  expect(cache.invalidateWorkItems).toHaveBeenCalledTimes(1);
  expect(history.recordTitleChanged).toHaveBeenCalledTimes(1);
  expect(publisher.publish).toHaveBeenCalledTimes(1);
});

it("returns the ticket when it already has the title", async () => {
  const { repository, service } = setup();

  await service.updateTitle(actor, "t", { baseTitle: "Old", title: "Old" });
  await service.updateTitle(actor, "t", { baseTitle: "Else", title: "Old" });

  expect(repository.updateTitle).not.toHaveBeenCalled();
});

it("compares a title with the form the database stores", async () => {
  const { repository, service } = setup({ existing: ticket({ title: "Ab" }) });

  await service.updateTitle(actor, "t", { baseTitle: "Ab", title: "A\u0000b" });

  expect(repository.storedTextForm).toHaveBeenCalledTimes(1);
  expect(repository.updateTitle).not.toHaveBeenCalled();
});

it("rejects a title in conflict, archived tickets and unusable titles", async () => {
  await expect(
    setup().service.updateTitle(actor, "t", { baseTitle: "X", title: "New" }),
  ).rejects.toThrow(WorkItemConflictError);
  await expect(
    setup({ existing: ticket({ archivedAt: "x" }) }).service.updateTitle(
      actor,
      "t",
      { baseTitle: "Old", title: "New" },
    ),
  ).rejects.toMatchObject({ code: "ticketArchived" });
  await expect(
    setup().service.updateTitle(actor, "t", { baseTitle: "Old", title: " " }),
  ).rejects.toThrow(WorkItemValidationError);
});

it("rejects a title that changed during the write", async () => {
  await expect(
    setup({ updated: false }).service.updateTitle(actor, "t", {
      baseTitle: "Old",
      title: "New",
    }),
  ).rejects.toThrow(WorkItemConflictError);
});

it("fails when the stored ticket cannot be read back", async () => {
  await expect(
    setup({ stored: null }).service.updateTitle(actor, "t", {
      baseTitle: "Old",
      title: "New",
    }),
  ).rejects.toThrow("Work item could not be retrieved after its change.");
});

it("updates a status", async () => {
  const { history, publisher, service } = setup();

  await service.updateStatus(actor, "t", {
    baseStatusId: "s1",
    statusId: "s2",
  });

  expect(history.recordStatusMove).toHaveBeenCalledTimes(1);
  expect(publisher.publish).toHaveBeenCalledTimes(1);
});

it("accepts a status of the own project", async () => {
  const { service } = setup({ status: { id: "s2", projectId: "p" } });

  await expect(
    service.updateStatus(actor, "t", { baseStatusId: "s1", statusId: "s2" }),
  ).resolves.toBeDefined();
});

it("rejects missing or foreign statuses", async () => {
  const change = { baseStatusId: "s1", statusId: "s2" };

  await expect(
    setup({ status: null }).service.updateStatus(actor, "t", change),
  ).rejects.toMatchObject({ code: "targetStatusNotFound" });
  await expect(
    setup({ status: { id: "s2", projectId: "other" } }).service.updateStatus(
      actor,
      "t",
      change,
    ),
  ).rejects.toMatchObject({ code: "targetStatusNotFound" });
});

it("rejects a status of an archived ticket and a status conflict", async () => {
  await expect(
    setup({ existing: ticket({ archivedAt: "x" }) }).service.updateStatus(
      actor,
      "t",
      { baseStatusId: "s1", statusId: "s2" },
    ),
  ).rejects.toMatchObject({ code: "ticketArchived" });
  await expect(
    setup().service.updateStatus(actor, "t", {
      baseStatusId: "s0",
      statusId: "s2",
    }),
  ).rejects.toThrow(WorkItemConflictError);
});

it("returns the ticket when it already has the status", async () => {
  const { repository, service } = setup({
    status: { id: "s1", projectId: null },
  });

  await service.updateStatus(actor, "t", {
    baseStatusId: "s1",
    statusId: "s1",
  });

  expect(repository.updateStatus).not.toHaveBeenCalled();
});

it("rejects a status that changed during the write", async () => {
  await expect(
    setup({ updated: false }).service.updateStatus(actor, "t", {
      baseStatusId: "s1",
      statusId: "s2",
    }),
  ).rejects.toThrow(WorkItemConflictError);
});

it("replaces a parent and records the change", async () => {
  const { history, validator, service } = setup();

  await service.updateParent(actor, "t", {
    baseParentId: "p1",
    parentId: " p2 ",
  });

  expect(validator.validateHierarchy).toHaveBeenCalledWith(
    expect.objectContaining({ parentId: "p2", storedParentId: "p1" }),
  );
  expect(history.recordParentChanged).toHaveBeenCalledWith(actor, {
    newParentId: "p2",
    oldParentKey: "P-1",
    workItemId: "t",
  });
});

it("keeps a hidden parent when no parent is named", async () => {
  const { repository, service } = setup({
    existing: ticket({ parentId: null }),
    hiddenParent: { id: "h" },
  });

  await expect(
    service.updateParent(actor, "t", { baseParentId: null, parentId: null }),
  ).resolves.toBeDefined();
  expect(repository.replaceParent).not.toHaveBeenCalled();
});

it("replaces a hidden parent by a named one", async () => {
  const { repository, service } = setup({
    existing: ticket({ parentId: null }),
    hiddenParent: { id: "h" },
  });

  await service.updateParent(actor, "t", {
    baseParentId: null,
    parentId: "p2",
  });

  expect(repository.replaceParent).toHaveBeenCalledWith("t", "p2", "h");
});

it("removes a parent", async () => {
  const { repository, service } = setup();

  await service.updateParent(actor, "t", {
    baseParentId: "p1",
    parentId: null,
  });

  expect(repository.replaceParent).toHaveBeenCalledWith("t", null, "p1");
});

it("rejects parent changes of archived tickets, in conflict or lost", async () => {
  await expect(
    setup({ existing: ticket({ archivedAt: "x" }) }).service.updateParent(
      actor,
      "t",
      { baseParentId: "p1", parentId: "p2" },
    ),
  ).rejects.toMatchObject({ code: "ticketArchived" });
  await expect(
    setup().service.updateParent(actor, "t", {
      baseParentId: "p0",
      parentId: "p2",
    }),
  ).rejects.toThrow(WorkItemConflictError);
  await expect(
    setup({ updated: false }).service.updateParent(actor, "t", {
      baseParentId: "p1",
      parentId: "p2",
    }),
  ).rejects.toThrow(WorkItemConflictError);
});
