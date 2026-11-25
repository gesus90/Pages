import { expect, it, vi } from "vitest";

import { visibleTaskHistory } from "./TaskHistoryVisibility";

import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { WorkItemHistory, WorkItemVisibility } from "@/definition/Task";

function doubleOf<Type>(value: unknown): Type {
  return value as Type;
}

const visibility = doubleOf<WorkItemVisibility>({ projectIds: ["p"] });

function entry(
  field: string,
  oldValue: string | null,
  newValue: string | null,
): WorkItemHistory {
  return doubleOf<WorkItemHistory>({ field, newValue, oldValue });
}

function repositoryOf(visible: string[]): {
  readonly repository: TaskRepository;
  readonly findVisibleKeys: ReturnType<typeof vi.fn>;
} {
  const findVisibleKeys = vi.fn(async () => new Set(visible));
  return {
    findVisibleKeys,
    repository: doubleOf<TaskRepository>({ findVisibleKeys }),
  };
}

it("returns the entries untouched when no parent key is involved", async () => {
  const { repository, findVisibleKeys } = repositoryOf([]);
  const entries = [entry("title", "a", "b"), entry("parent", null, null)];

  await expect(
    visibleTaskHistory(repository, entries, visibility),
  ).resolves.toBe(entries);
  expect(findVisibleKeys).not.toHaveBeenCalled();
});

it("keeps visible parent keys and redacts hidden ones", async () => {
  const { repository, findVisibleKeys } = repositoryOf(["A-1"]);
  const title = entry("title", "x", "y");

  const result = await visibleTaskHistory(
    repository,
    [title, entry("parent", "A-1", "B-2"), entry("parent", "A-1", null)],
    visibility,
  );

  expect(findVisibleKeys).toHaveBeenCalledWith(["A-1", "B-2"], visibility);
  expect(result[0]).toBe(title);
  expect(result[1]).toMatchObject({ newValue: null, oldValue: "A-1" });
  expect(result[2]).toMatchObject({ newValue: null, oldValue: "A-1" });
});

it("keeps a visible new parent key", async () => {
  const { repository } = repositoryOf(["B-2"]);

  const result = await visibleTaskHistory(
    repository,
    [entry("parent", null, "B-2"), entry("parent", "A-1", "B-2")],
    visibility,
  );

  expect(result[0]).toMatchObject({ newValue: "B-2", oldValue: null });
  expect(result[1]).toMatchObject({ newValue: "B-2", oldValue: null });
});
