import { describe, expect, it } from "vitest";

import {
  countOpenSubtasks,
  getMilestoneCompletion,
  getMilestoneProgress,
  getTaskCompletion,
} from "@/app/components/projects/project-progress";

import type { ProgressWorkItem } from "@/app/components/projects/project-progress";

function createItem(
  overrides: Partial<ProgressWorkItem> = {},
): ProgressWorkItem {
  return {
    isDone: false,
    milestoneId: null,
    type: "task",
    ...overrides,
  };
}

describe("getTaskCompletion", () => {
  it("returns zero values without work items", () => {
    expect(getTaskCompletion([])).toEqual({ done: 0, percentage: 0, total: 0 });
  });

  it("aggregates completed work items", () => {
    const items = [
      createItem({ isDone: true }),
      createItem({ isDone: true }),
      createItem(),
      createItem(),
    ];

    expect(getTaskCompletion(items)).toEqual({
      done: 2,
      percentage: 50,
      total: 4,
    });
  });
});

describe("getMilestoneProgress", () => {
  it("computes progress only from assigned tasks", () => {
    const items = [
      createItem({ isDone: true, milestoneId: "milestone-1" }),
      createItem({ milestoneId: "milestone-1" }),
      createItem({ isDone: true, milestoneId: "milestone-2" }),
    ];

    expect(getMilestoneProgress("milestone-1", items)).toEqual({
      done: 1,
      percentage: 50,
      total: 2,
    });
    expect(getMilestoneProgress("missing", items)).toEqual({
      done: 0,
      percentage: 0,
      total: 0,
    });
  });
});

describe("getMilestoneCompletion", () => {
  it("counts completed milestones", () => {
    expect(
      getMilestoneCompletion([
        {
          archivedAt: null,
          completedAt: null,
          createdAt: "2026-01-01",
          description: "",
          dueAt: null,
          id: "milestone-1",
          name: "MVP",
          projectId: "project-1",
          startAt: null,
          status: "completed",
          updatedAt: "2026-01-02",
        },
        {
          archivedAt: null,
          completedAt: null,
          createdAt: "2026-01-01",
          description: "",
          dueAt: null,
          id: "milestone-2",
          name: "Release",
          projectId: "project-1",
          startAt: null,
          status: "open",
          updatedAt: "2026-01-02",
        },
      ]),
    ).toEqual({ done: 1, percentage: 50, total: 2 });
  });
});

describe("countOpenSubtasks", () => {
  it("counts only non-completed subtasks", () => {
    const items = [
      createItem({ type: "subtask" }),
      createItem({ isDone: true, type: "subtask" }),
      createItem({ type: "task" }),
    ];

    expect(countOpenSubtasks(items)).toBe(1);
  });
});
