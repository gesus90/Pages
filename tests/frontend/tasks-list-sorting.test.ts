import { describe, expect, it } from "vitest";

import { sortWorkItems } from "@/app/components/tasks/list/tasks-list-sorting";
import { WORK_ITEM_PRIORITY } from "@/definition/Task";

import { createWorkItem } from "../helpers/factories";

import type { TaskSortField } from "@/app/components/tasks/list/tasks-list-sorting";

describe("sortWorkItems", () => {
  const early = createWorkItem({
    dueAt: "2026-01-01",
    id: "early",
    priority: WORK_ITEM_PRIORITY.LOW,
    projectName: "Alpha",
    sortOrder: 2,
    statusName: "Backlog",
    title: "Apple",
    updatedAt: "2026-01-01",
  });
  const late = createWorkItem({
    dueAt: "2026-03-01",
    id: "late",
    priority: WORK_ITEM_PRIORITY.URGENT,
    projectName: "Beta",
    sortOrder: 1,
    statusName: "Done",
    title: "Banana",
    updatedAt: "2026-02-01",
  });
  const undated = createWorkItem({
    dueAt: null,
    id: "undated",
    sortOrder: 3,
    updatedAt: "2026-03-01",
  });

  it.each<[TaskSortField, string[]]>([
    ["manual", ["late", "early", "undated"]],
    ["updated", ["early", "late", "undated"]],
    ["priority", ["early", "undated", "late"]],
    ["dueDate", ["undated", "early", "late"]],
    ["title", ["early", "late", "undated"]],
    ["project", ["early", "late", "undated"]],
    ["status", ["early", "late", "undated"]],
  ])("orders by %s ascending", (field, expected) => {
    const ids = sortWorkItems([early, late, undated], field, "asc").map(
      (item) => item.id,
    );

    if (field === "title" || field === "project" || field === "status") {
      expect(ids.slice(0, 2)).toEqual(expected.slice(0, 2));
    } else {
      expect(ids).toEqual(expected);
    }
  });

  it("reverses descending and leaves the input untouched", () => {
    const items = [early, late];

    expect(
      sortWorkItems(items, "manual", "desc").map((item) => item.id),
    ).toEqual(["early", "late"]);
    expect(items).toEqual([early, late]);
  });
});
