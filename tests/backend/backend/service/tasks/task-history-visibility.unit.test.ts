import { describe, expect, it, vi } from "vitest";

import type { MockInstance } from "vitest";

import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { visibleTaskHistory } from "@/backend/service/task/TaskHistoryVisibility";

import { bareInstance } from "./bare-instance";

import type { WorkItemHistory, WorkItemVisibility } from "@/definition/Task";

const VISIBILITY: WorkItemVisibility = { departmentIds: ["design"] };

function entry(overrides: Partial<WorkItemHistory>): WorkItemHistory {
  return {
    id: "history-1",
    workItemId: "ticket-1",
    userId: "user-1",
    userDisplayName: "Ada",
    action: "updated",
    field: "title",
    oldValue: "Old",
    newValue: "New",
    createdAt: "2026-01-01 00:00:00",
    ...overrides,
  };
}

function repositoryWithVisible(visible: readonly string[]): {
  lookup: MockInstance<TaskRepository["findVisibleKeys"]>;
  repository: TaskRepository;
} {
  const repository = bareInstance(TaskRepository.prototype);
  const lookup = vi
    .spyOn(repository, "findVisibleKeys")
    .mockImplementation(async () => new Set(visible));
  return { lookup, repository };
}

describe("visibleTaskHistory", () => {
  it("returns the entries untouched without asking when no parent entry exists", async () => {
    const { lookup, repository } = repositoryWithVisible([]);
    const entries = [entry({}), entry({ id: "history-2", field: null })];

    const result = await visibleTaskHistory(repository, entries, VISIBILITY);

    expect(result).toBe(entries);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("does not ask for parent entries that carry no key at all", async () => {
    const { lookup, repository } = repositoryWithVisible([]);
    const entries = [
      entry({ field: "parent", oldValue: null, newValue: null }),
    ];

    const result = await visibleTaskHistory(repository, entries, VISIBILITY);

    expect(result).toBe(entries);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("asks once with each distinct key and the actor's visibility", async () => {
    const { lookup, repository } = repositoryWithVisible(["ALP-1"]);

    await visibleTaskHistory(
      repository,
      [
        entry({ field: "parent", oldValue: "ALP-1", newValue: "ALP-2" }),
        entry({ field: "parent", oldValue: "ALP-2", newValue: null }),
      ],
      VISIBILITY,
    );

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith(["ALP-1", "ALP-2"], VISIBILITY);
  });

  it("redacts only the parent keys outside the visible scope", async () => {
    const { repository } = repositoryWithVisible(["ALP-1"]);
    const title = entry({ id: "history-title", oldValue: "ALP-9" });

    const result = await visibleTaskHistory(
      repository,
      [
        entry({
          id: "history-both",
          field: "parent",
          oldValue: "ALP-1",
          newValue: "ALP-2",
        }),
        entry({
          id: "history-added",
          field: "parent",
          oldValue: null,
          newValue: "ALP-1",
        }),
        entry({
          id: "history-removed",
          field: "parent",
          oldValue: "ALP-2",
          newValue: null,
        }),
        title,
      ],
      VISIBILITY,
    );

    expect(
      result.map((item) => [item.id, item.oldValue, item.newValue]),
    ).toEqual([
      ["history-both", "ALP-1", null],
      ["history-added", null, "ALP-1"],
      ["history-removed", null, null],
      ["history-title", "ALP-9", "New"],
    ]);
    expect(result[3]).toBe(title);
  });
});
