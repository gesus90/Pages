import { describe, expect, it } from "vitest";

import { BOARD_GROUP_NONE_KEY, groupWorkItems } from "@/app/lib/board-groups";

import { label, workItem } from "./work-item-fixture";

import type { BoardGroupLookups } from "@/app/lib/board-groups";

const LOOKUPS: BoardGroupLookups = {
  labelsByWorkItem: {
    a: [label("ui", "UI"), label("bug", "Bug")],
    b: [label("bug", "Bug")],
  },
  departmentNames: { d1: "Engineering", d2: "Accounting" },
};

function keys(sections: readonly { readonly key: string }[]): string[] {
  return sections.map((section) => section.key);
}

describe("grouping work items", () => {
  const a = workItem("a", {
    projectId: "p2",
    projectName: "Zeta",
    priority: "low",
  });
  const b = workItem("b", {
    projectId: "p1",
    projectName: "Alpha",
    priority: "urgent",
  });
  const c = workItem("c", {
    projectId: "p2",
    projectName: "Zeta",
    priority: "high",
  });

  it("keeps one untitled section in the given order for no grouping", () => {
    const sections = groupWorkItems([c, a, b], "none", LOOKUPS);

    expect(sections).toEqual([
      {
        key: BOARD_GROUP_NONE_KEY,
        kind: "none",
        title: null,
        items: [c, a, b],
      },
    ]);
  });

  it("groups by project and sorts the sections by project name", () => {
    const sections = groupWorkItems([a, b, c], "project", LOOKUPS);

    expect(keys(sections)).toEqual(["p1", "p2"]);
    expect(sections.map((section) => section.title)).toEqual(["Alpha", "Zeta"]);
    expect(sections[1]?.items).toEqual([a, c]);
  });

  it("orders priority sections from urgent to low", () => {
    const sections = groupWorkItems([a, b, c], "priority", LOOKUPS);

    expect(keys(sections)).toEqual(["urgent", "high", "low"]);
    expect(sections.every((section) => section.title === null)).toBe(true);
  });

  it("groups by person or by group and puts the unassigned last", () => {
    const person = workItem("p", { assigneeId: "u1", assigneeName: "Zoe" });
    const other = workItem("q", { assigneeId: "u2", assigneeName: "Adam" });
    const group = workItem("g", {
      assigneeGroupId: "g1",
      assigneeGroupName: "Team",
    });
    const nobody = workItem("n");

    const sections = groupWorkItems(
      [nobody, person, group, other],
      "assignee",
      LOOKUPS,
    );

    expect(keys(sections)).toEqual([
      "u2",
      "group:g1",
      "u1",
      BOARD_GROUP_NONE_KEY,
    ]);
    expect(sections.at(-1)?.items).toEqual([nobody]);
  });

  it("groups by department with the department name, an unknown one untitled, none last", () => {
    const named = workItem("d", { departmentId: "d1" });
    const accounting = workItem("e", { departmentId: "d2" });
    const unknown = workItem("f", { departmentId: "d9" });
    const without = workItem("g");

    const sections = groupWorkItems(
      [without, named, unknown, accounting],
      "department",
      LOOKUPS,
    );

    expect(sections.map((section) => section.title)).toEqual([
      null,
      "Accounting",
      "Engineering",
      null,
    ]);
    expect(keys(sections)).toEqual(["d9", "d2", "d1", BOARD_GROUP_NONE_KEY]);
  });

  it("lists an item with several labels in every one of its sections", () => {
    const unlabeled = workItem("z");
    const first = workItem("a");
    const second = workItem("b");

    const sections = groupWorkItems(
      [first, second, unlabeled],
      "label",
      LOOKUPS,
    );

    expect(keys(sections)).toEqual(["bug", "ui", BOARD_GROUP_NONE_KEY]);
    expect(sections[0]?.items).toEqual([first, second]);
    expect(sections[1]?.items).toEqual([first]);
    expect(sections[2]?.items).toEqual([unlabeled]);
  });

  it("returns no section for no items", () => {
    expect(groupWorkItems([], "project", LOOKUPS)).toEqual([]);
  });
});
