import { describe, expect, it } from "vitest";

import {
  FILTER_ALL,
  countActiveFilters,
  filterWorkItems,
  toTaskFilters,
} from "@/app/lib/task-filters";
import { DEFAULT_BOARD_PREFERENCES } from "@/definition/BoardPreferences";

import { label, workItem as item } from "./work-item-fixture";

import type { TaskFilters, TaskViewer } from "@/app/lib/task-filters";
import type { BoardPreferences } from "@/definition/BoardPreferences";
import type { WorkItemDetail } from "@/definition/Task";

const VIEWER: TaskViewer = {
  actorId: "me",
  memberGroupIds: ["g1"],
  labelsByWorkItem: { a: [label("bug")], b: [label("ui"), label("bug")] },
};

/** The default filters with the given deviations. */
function filters(overrides: Partial<TaskFilters> = {}): TaskFilters {
  return { ...DEFAULT_BOARD_PREFERENCES, ...overrides };
}

function ids(found: readonly WorkItemDetail[]): string[] {
  return found.map((entry) => entry.id);
}

describe("filtering work items", () => {
  const items = [
    item("a", { assigneeId: "me", priority: "high", milestoneId: "m1" }),
    item("b", { assigneeGroupId: "g1", type: "subtask", statusId: "done" }),
    item("c", { assigneeId: "other", projectId: "p2", departmentId: "d1" }),
    item("d", { type: "epic", title: "Search Target" }),
    item("e", { assigneeGroupId: "g9", key: "ABC-77" }),
  ];

  it("keeps everything for the default filters except tickets that are no work", () => {
    expect(ids(filterWorkItems(items, filters(), VIEWER))).toEqual([
      "a",
      "b",
      "c",
      "e",
    ]);
    expect(
      ids(filterWorkItems(items, filters({ type: "all" }), VIEWER)),
    ).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("limits the scope to tickets assigned to the person or to a group they belong to", () => {
    expect(
      ids(filterWorkItems(items, filters({ scope: "mine" }), VIEWER)),
    ).toEqual(["a", "b"]);
  });

  it("matches project, status, priority and milestone exactly", () => {
    expect(
      ids(filterWorkItems(items, filters({ project: "p2" }), VIEWER)),
    ).toEqual(["c"]);
    expect(
      ids(filterWorkItems(items, filters({ status: "done" }), VIEWER)),
    ).toEqual(["b"]);
    expect(
      ids(filterWorkItems(items, filters({ priority: "high" }), VIEWER)),
    ).toEqual(["a"]);
    expect(
      ids(filterWorkItems(items, filters({ milestone: "m1" }), VIEWER)),
    ).toEqual(["a"]);
  });

  it("filters by a concrete ticket type", () => {
    expect(
      ids(filterWorkItems(items, filters({ type: "epic" }), VIEWER)),
    ).toEqual(["d"]);
    expect(
      ids(filterWorkItems(items, filters({ type: "subtask" }), VIEWER)),
    ).toEqual(["b"]);
  });
});

describe("filtering by assignee, department and text", () => {
  const items = [
    item("a", { assigneeId: "me", priority: "high", milestoneId: "m1" }),
    item("b", { assigneeGroupId: "g1", type: "subtask", statusId: "done" }),
    item("c", { assigneeId: "other", projectId: "p2", departmentId: "d1" }),
    item("d", { type: "epic", title: "Search Target" }),
    item("e", { assigneeGroupId: "g9", key: "ABC-77" }),
  ];

  it("filters by assignee: a person, a group, nobody", () => {
    expect(
      ids(filterWorkItems(items, filters({ assignee: "other" }), VIEWER)),
    ).toEqual(["c"]);
    expect(
      ids(filterWorkItems(items, filters({ assignee: "group:g9" }), VIEWER)),
    ).toEqual(["e"]);
    expect(
      ids(
        filterWorkItems(
          items,
          filters({ assignee: "none", type: "all" }),
          VIEWER,
        ),
      ),
    ).toEqual(["d"]);
  });

  it("filters by department: a concrete one or none", () => {
    expect(
      ids(filterWorkItems(items, filters({ department: "d1" }), VIEWER)),
    ).toEqual(["c"]);
    expect(
      ids(filterWorkItems(items, filters({ department: "none" }), VIEWER)),
    ).toEqual(["a", "b", "e"]);
  });

  it("keeps tickets that carry any of the selected labels", () => {
    expect(
      ids(filterWorkItems(items, filters({ labelIds: ["ui"] }), VIEWER)),
    ).toEqual(["b"]);
    expect(
      ids(filterWorkItems(items, filters({ labelIds: ["bug"] }), VIEWER)),
    ).toEqual(["a", "b"]);
    expect(
      ids(
        filterWorkItems(items, filters({ labelIds: ["bug"] }), {
          ...VIEWER,
          labelsByWorkItem: undefined,
        }),
      ),
    ).toEqual([]);
  });

  it("searches title and key case-insensitively and ignores blank searches", () => {
    expect(
      ids(
        filterWorkItems(
          items,
          filters({ search: "  search target ", type: "all" }),
          VIEWER,
        ),
      ),
    ).toEqual(["d"]);
    expect(
      ids(filterWorkItems(items, filters({ search: "abc-77" }), VIEWER)),
    ).toEqual(["e"]);
    expect(
      ids(filterWorkItems(items, filters({ search: "   " }), VIEWER)),
    ).toEqual(["a", "b", "c", "e"]);
  });

  it("combines all filters", () => {
    expect(
      ids(
        filterWorkItems(
          items,
          filters({
            scope: "mine",
            priority: "high",
            labelIds: ["bug"],
            search: "title a",
          }),
          VIEWER,
        ),
      ),
    ).toEqual(["a"]);
    expect(FILTER_ALL).toBe("all");
  });
});

describe("filters from preferences", () => {
  it("shows every ticket type in the hierarchy instead of the work filter", () => {
    const hierarchy: BoardPreferences = {
      ...DEFAULT_BOARD_PREFERENCES,
      view: "hierarchy",
    };

    expect(toTaskFilters(hierarchy).type).toBe("all");
    expect(toTaskFilters({ ...hierarchy, type: "epic" }).type).toBe("epic");
    expect(toTaskFilters(DEFAULT_BOARD_PREFERENCES)).toBe(
      DEFAULT_BOARD_PREFERENCES,
    );
  });

  it("counts every deviation from the defaults, the archive filter included", () => {
    expect(countActiveFilters(DEFAULT_BOARD_PREFERENCES, "active")).toBe(0);
    expect(countActiveFilters(DEFAULT_BOARD_PREFERENCES, "archived")).toBe(1);
    expect(
      countActiveFilters(
        {
          ...DEFAULT_BOARD_PREFERENCES,
          scope: "mine",
          project: "p1",
          type: "task",
          status: "done",
          priority: "high",
          milestone: "m1",
          assignee: "me",
          department: "d1",
          labelIds: ["bug"],
        },
        "all",
      ),
    ).toBe(10);
  });
});
