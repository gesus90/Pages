import { describe, expect, it, vi } from "vitest";

import { WorkItemValidationError } from "@/backend/error/WorkItemErrors";

import { TaskChecklistService } from "./TaskChecklistService";

import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { TaskAccessGuard } from "@/backend/service/task/TaskAccessGuard";
import type { WorkItemChecklistItem } from "@/definition/Task";
import type { ChecklistItemUpdate } from "@/backend/database/repositories/task/WorkItemChecklistRepository";
import type { User } from "@/definition/User";

function doubleOf<Type>(value: unknown): Type {
  return value as Type;
}

const actor = doubleOf<User>({ id: "u1" });
const item = doubleOf<WorkItemChecklistItem>({
  id: "c1",
  isDone: false,
  title: "Old",
  workItemId: "w1",
});
const expected = doubleOf<ChecklistItemUpdate>({
  isDone: false,
  title: "Old",
});

function setup(found: WorkItemChecklistItem | null = item): {
  readonly service: TaskChecklistService;
  readonly repository: Record<string, ReturnType<typeof vi.fn>>;
  readonly access: Record<string, ReturnType<typeof vi.fn>>;
} {
  const repository = {
    deleteChecklistItem: vi.fn(async () => {}),
    deleteChecklistItemIfCurrent: vi.fn(async () => true),
    findChecklistItemById: vi.fn(async () => found),
    findChecklistItemsByWorkItemId: vi.fn(async () => [item]),
    insertChecklistItem: vi.fn(async () => {}),
    setChecklistItemDoneIfCurrent: vi.fn(async () => true),
    updateChecklistItem: vi.fn(async () => {}),
  };
  const access = {
    requireWorkItem: vi.fn(async () => {}),
    requireWritableWorkItem: vi.fn(async () => {}),
  };

  return {
    access,
    repository,
    service: new TaskChecklistService(
      doubleOf<TaskRepository>(repository),
      doubleOf<TaskAccessGuard>(access),
    ),
  };
}

describe("TaskChecklistService", () => {
  it("lists the checklist after checking access", async () => {
    const { access, service } = setup();

    await expect(service.findChecklistItems(actor, "w1")).resolves.toEqual([
      item,
    ]);
    expect(access.requireWorkItem).toHaveBeenCalledWith(actor, "w1");
  });

  it("adds a trimmed and truncated item", async () => {
    const { repository, service } = setup();

    await expect(
      service.addChecklistItem(actor, "w1", `  ${"x".repeat(300)}  `),
    ).resolves.toBe(item);
    expect(repository.insertChecklistItem.mock.calls[0][0]).toMatchObject({
      title: "x".repeat(200),
      workItemId: "w1",
    });
  });

  it("rejects an empty title", async () => {
    const { service } = setup();

    await expect(service.addChecklistItem(actor, "w1", "  ")).rejects.toThrow(
      WorkItemValidationError,
    );
  });

  it("fails when the created item cannot be read back", async () => {
    const { service } = setup(null);

    await expect(service.addChecklistItem(actor, "w1", "a")).rejects.toThrow(
      "Created checklist item",
    );
  });

  it("sets the done state without a guard", async () => {
    const { repository, service } = setup();

    await expect(service.setChecklistItemDone(actor, "c1", true)).resolves.toBe(
      item,
    );
    expect(repository.updateChecklistItem).toHaveBeenCalledWith("c1", {
      isDone: true,
      title: "Old",
    });
  });

  it("sets the done state against an expected state", async () => {
    const { repository, service } = setup();

    await service.setChecklistItemDone(actor, "c1", true, expected);

    expect(repository.setChecklistItemDoneIfCurrent).toHaveBeenCalledWith(
      "c1",
      true,
      expected,
    );
    expect(repository.updateChecklistItem).not.toHaveBeenCalled();
  });

  it("reports a conflict when the expected state changed", async () => {
    const { repository, service } = setup();
    repository.setChecklistItemDoneIfCurrent.mockResolvedValue(false);

    await expect(
      service.setChecklistItemDone(actor, "c1", true, expected),
    ).rejects.toThrow(WorkItemValidationError);
  });

  it("fails when the updated item cannot be read back", async () => {
    const { repository, service } = setup();
    repository.findChecklistItemById
      .mockResolvedValueOnce(item)
      .mockResolvedValueOnce(null);

    await expect(
      service.setChecklistItemDone(actor, "c1", true),
    ).rejects.toThrow("Updated checklist item");
  });

  it("rejects an unknown item", async () => {
    const { service } = setup(null);

    await expect(service.deleteChecklistItem(actor, "c1")).rejects.toThrow(
      WorkItemValidationError,
    );
  });

  it("deletes with and without an expected state", async () => {
    const { repository, service } = setup();

    await service.deleteChecklistItem(actor, "c1");
    await service.deleteChecklistItem(actor, "c1", expected);

    expect(repository.deleteChecklistItem).toHaveBeenCalledWith("c1");
    expect(repository.deleteChecklistItemIfCurrent).toHaveBeenCalledWith(
      "c1",
      expected,
    );
  });

  it("reports a conflict when a guarded delete removes nothing", async () => {
    const { repository, service } = setup();
    repository.deleteChecklistItemIfCurrent.mockResolvedValue(false);

    await expect(
      service.deleteChecklistItem(actor, "c1", expected),
    ).rejects.toThrow(WorkItemValidationError);
  });
});
