import { describe, expect, it } from "vitest";

import { sanitizeBoardReferences } from "@/app/lib/board-references";
import { DEFAULT_BOARD_PREFERENCES } from "@/definition/BoardPreferences";

import type { BoardReferences } from "@/app/lib/board-references";
import type { BoardPreferences } from "@/definition/BoardPreferences";

const REFERENCES: BoardReferences = {
  projectIds: new Set(["p1"]),
  statusIds: new Set(["s1"]),
  milestoneIds: new Set(["m1"]),
  labelIds: new Set(["l1", "l2"]),
  departmentIds: new Set(["d1"]),
  assigneeIds: new Set(["u1"]),
  groupIds: new Set(["g1"]),
};

function sanitize(overrides: Partial<BoardPreferences>): BoardPreferences {
  return sanitizeBoardReferences(
    { ...DEFAULT_BOARD_PREFERENCES, ...overrides },
    REFERENCES,
  );
}

describe("sanitizing board references", () => {
  it("keeps references that still exist", () => {
    const kept = {
      project: "p1",
      status: "s1",
      milestone: "m1",
      department: "d1",
      assignee: "u1",
      labelIds: ["l1", "l2"],
    };

    expect(sanitize(kept)).toMatchObject(kept);
  });

  it("falls back to all for references that are gone", () => {
    expect(
      sanitize({
        project: "gone",
        status: "gone",
        milestone: "gone",
        department: "gone",
        assignee: "gone",
      }),
    ).toMatchObject({
      project: "all",
      status: "all",
      milestone: "all",
      department: "all",
      assignee: "all",
    });
  });

  it("keeps the all and none choices where they are offered", () => {
    expect(sanitize({ department: "none", assignee: "none" })).toMatchObject({
      department: "none",
      assignee: "none",
    });
    expect(
      sanitize({ project: "none", status: "none", milestone: "none" }),
    ).toMatchObject({
      project: "all",
      status: "all",
      milestone: "all",
    });
    expect(sanitize({ project: "all" }).project).toBe("all");
  });

  it("checks a group assignee against the known groups", () => {
    expect(sanitize({ assignee: "group:g1" }).assignee).toBe("group:g1");
    expect(sanitize({ assignee: "group:gone" }).assignee).toBe("all");
  });

  it("drops labels that are gone and leaves every other preference alone", () => {
    const sanitized = sanitize({
      labelIds: ["l1", "gone"],
      search: "bug",
      view: "list",
    });

    expect(sanitized.labelIds).toEqual(["l1"]);
    expect(sanitized).toMatchObject({ search: "bug", view: "list" });
  });
});
