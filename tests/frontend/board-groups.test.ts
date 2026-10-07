import { describe, expect, it } from "vitest";

import { groupWorkItems } from "@/app/lib/board-groups";
import { WORK_ITEM_PRIORITY } from "@/definition/Task";

import { createWorkItem } from "../helpers/factories";

import type { Label } from "@/definition/Task";

function createLabel(id: string, name: string): Label {
  return { color: "#f97316", createdAt: "", id, name, updatedAt: "" };
}

const NO_LOOKUPS = { departmentNames: {}, labelsByWorkItem: {} };

describe("groupWorkItems", () => {
  const first = createWorkItem({
    departmentId: "d2",
    id: "1",
    priority: WORK_ITEM_PRIORITY.LOW,
    projectId: "p2",
    projectName: "Zeta",
  });
  const second = createWorkItem({
    assigneeGroupId: "g1",
    assigneeGroupName: "Design",
    assigneeId: null,
    departmentId: "d1",
    id: "2",
    priority: WORK_ITEM_PRIORITY.URGENT,
    projectId: "p1",
    projectName: "Alpha",
  });
  const third = createWorkItem({
    assigneeGroupId: null,
    assigneeId: null,
    departmentId: null,
    id: "3",
    priority: WORK_ITEM_PRIORITY.NORMAL,
    projectId: "p1",
    projectName: "Alpha",
  });
  const items = [first, second, third];

  it("returns a single untitled section without grouping", () => {
    expect(groupWorkItems(items, "none", NO_LOOKUPS)).toEqual([
      { items, key: "none", kind: "none", title: null },
    ]);
  });

  it("groups by project in alphabetical order and keeps the item order", () => {
    const sections = groupWorkItems(items, "project", NO_LOOKUPS);

    expect(sections.map((section) => section.title)).toEqual(["Alpha", "Zeta"]);
    expect(sections[0]?.items.map((item) => item.id)).toEqual(["2", "3"]);
  });

  it("groups by priority from urgent to low", () => {
    expect(
      groupWorkItems(items, "priority", NO_LOOKUPS).map(
        (section) => section.key,
      ),
    ).toEqual(["urgent", "normal", "low"]);
  });

  it("groups by assignee with people, groups and the unassigned last", () => {
    const sections = groupWorkItems(items, "assignee", NO_LOOKUPS);

    expect(sections.map((section) => [section.key, section.title])).toEqual([
      ["user-1", "Admin User"],
      ["group:g1", "Design"],
      ["none", null],
    ]);
  });

  it("puts an unassigned ticket after the named assignees", () => {
    const sections = groupWorkItems([third, first], "assignee", NO_LOOKUPS);

    expect(sections.map((section) => section.key)).toEqual(["user-1", "none"]);
  });

  it("groups by department with the names of the lookup", () => {
    const sections = groupWorkItems(items, "department", {
      ...NO_LOOKUPS,
      departmentNames: { d1: "Entwicklung" },
    });

    expect(sections.map((section) => [section.key, section.title])).toEqual([
      ["d2", null],
      ["d1", "Entwicklung"],
      ["none", null],
    ]);
  });

  it("keeps departments without a known name together in a stable order", () => {
    const sections = groupWorkItems(
      [
        createWorkItem({ departmentId: "d3", id: "a" }),
        createWorkItem({ departmentId: "d4", id: "b" }),
      ],
      "department",
      NO_LOOKUPS,
    );

    expect(sections.map((section) => section.key)).toEqual(["d3", "d4"]);
  });

  it("lists a ticket in the section of each of its labels", () => {
    const bug = createLabel("l1", "Bug");
    const ui = createLabel("l2", "UI");
    const sections = groupWorkItems(items, "label", {
      ...NO_LOOKUPS,
      labelsByWorkItem: { "1": [ui, bug], "2": [bug] },
    });

    expect(
      sections.map((section) => [
        section.title,
        section.items.map((item) => item.id),
      ]),
    ).toEqual([
      ["Bug", ["1", "2"]],
      ["UI", ["1"]],
      [null, ["3"]],
    ]);
  });
});
