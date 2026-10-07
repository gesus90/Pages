import { describe, expect, it } from "vitest";

import { filterWorkItems, toTaskFilters } from "@/app/lib/task-filters";
import { DEFAULT_BOARD_PREFERENCES } from "@/definition/BoardPreferences";
import { createWorkItem } from "../helpers/factories";

import type { TaskFilters } from "@/app/lib/task-filters";
import type { Label } from "@/definition/Task";

describe("filterWorkItems", () => {
  const own = createWorkItem({ id: "own", assigneeId: "me" });
  const grouped = createWorkItem({
    id: "grouped",
    assigneeGroupId: "mine",
    assigneeId: null,
  });
  const foreignGroup = createWorkItem({
    id: "foreign",
    assigneeGroupId: "other",
    assigneeId: null,
  });
  const nobody = createWorkItem({
    id: "nobody",
    assigneeGroupId: null,
    assigneeId: null,
  });
  const viewer = { actorId: "me", memberGroupIds: ["mine"] };

  it("keeps tickets assigned to the viewer or to one of their groups", () => {
    const ids = filterWorkItems(
      [own, grouped, foreignGroup, nobody],
      { ...DEFAULT_BOARD_PREFERENCES, scope: "mine" },
      viewer,
    ).map((item) => item.id);

    expect(ids).toEqual(["own", "grouped"]);
  });

  it("shows every ticket in the all scope", () => {
    const items = [own, grouped, foreignGroup, nobody];

    expect(
      filterWorkItems(items, DEFAULT_BOARD_PREFERENCES, viewer),
    ).toHaveLength(4);
  });

  it("shows tasks and subtasks by default and every type on request", () => {
    const epic = createWorkItem({ id: "epic", type: "epic" });
    const task = createWorkItem({ id: "task", type: "task" });
    const subtask = createWorkItem({ id: "sub", type: "subtask" });
    const items = [epic, task, subtask];
    const ids = (type: TaskFilters["type"]): string[] =>
      filterWorkItems(
        items,
        { ...DEFAULT_BOARD_PREFERENCES, type },
        viewer,
      ).map((item) => item.id);

    expect(ids("work")).toEqual(["task", "sub"]);
    expect(ids("all")).toEqual(["epic", "task", "sub"]);
    expect(ids("epic")).toEqual(["epic"]);
  });

  it("filters by assignee, group and unassigned", () => {
    const items = [own, grouped, nobody];
    const ids = (assignee: string): string[] =>
      filterWorkItems(
        items,
        { ...DEFAULT_BOARD_PREFERENCES, assignee },
        viewer,
      ).map((item) => item.id);

    expect(ids("me")).toEqual(["own"]);
    expect(ids("group:mine")).toEqual(["grouped"]);
    expect(ids("none")).toEqual(["nobody"]);
    expect(ids("all")).toHaveLength(3);
  });

  it("filters by department including tickets without one", () => {
    const sales = createWorkItem({ departmentId: "sales", id: "sales" });
    const ids = (department: string): string[] =>
      filterWorkItems(
        [sales, nobody],
        { ...DEFAULT_BOARD_PREFERENCES, department },
        viewer,
      ).map((item) => item.id);

    expect(ids("sales")).toEqual(["sales"]);
    expect(ids("none")).toEqual(["nobody"]);
    expect(ids("all")).toHaveLength(2);
  });

  it("lets a ticket pass when it carries any selected label", () => {
    const label = (id: string): Label => ({
      color: "#f97316",
      createdAt: "",
      id,
      name: id,
      updatedAt: "",
    });
    const labelled = {
      ...viewer,
      labelsByWorkItem: { own: [label("a")], grouped: [label("b")] },
    };
    const ids = (labelIds: string[], context = labelled): string[] =>
      filterWorkItems(
        [own, grouped, nobody],
        { ...DEFAULT_BOARD_PREFERENCES, labelIds },
        context,
      ).map((item) => item.id);

    expect(ids(["a", "b"])).toEqual(["own", "grouped"]);
    expect(ids(["b"])).toEqual(["grouped"]);
    expect(ids([])).toHaveLength(3);
    expect(ids(["a"], viewer as typeof labelled)).toEqual([]);
  });

  it("lifts the default type filter in the hierarchy view only", () => {
    expect(
      toTaskFilters({ ...DEFAULT_BOARD_PREFERENCES, view: "hierarchy" }).type,
    ).toBe("all");
    expect(
      toTaskFilters({
        ...DEFAULT_BOARD_PREFERENCES,
        type: "epic",
        view: "hierarchy",
      }).type,
    ).toBe("epic");
    expect(toTaskFilters(DEFAULT_BOARD_PREFERENCES).type).toBe("work");
  });
});
