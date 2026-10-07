import { describe, expect, it } from "vitest";

import { sanitizeBoardReferences } from "@/app/lib/board-references";
import { DEFAULT_BOARD_PREFERENCES } from "@/definition/BoardPreferences";

const references = {
  assigneeIds: new Set(["user-1"]),
  departmentIds: new Set(["d1"]),
  groupIds: new Set(["g1"]),
  labelIds: new Set(["l1"]),
  milestoneIds: new Set(["m1"]),
  projectIds: new Set(["p1"]),
  statusIds: new Set(["s1"]),
};

describe("sanitizeBoardReferences", () => {
  it("keeps filters that point to something visible", () => {
    const preferences = {
      ...DEFAULT_BOARD_PREFERENCES,
      assignee: "group:g1",
      department: "d1",
      labelIds: ["l1"],
      milestone: "m1",
      project: "p1",
      status: "s1",
    };

    expect(sanitizeBoardReferences(preferences, references)).toEqual(
      preferences,
    );
    expect(
      sanitizeBoardReferences(
        { ...preferences, assignee: "user-1", department: "none" },
        references,
      ),
    ).toMatchObject({ assignee: "user-1", department: "none" });
    expect(
      sanitizeBoardReferences({ ...preferences, assignee: "none" }, references)
        .assignee,
    ).toBe("none");
  });

  it("drops filters that point to something that vanished", () => {
    expect(
      sanitizeBoardReferences(
        {
          ...DEFAULT_BOARD_PREFERENCES,
          assignee: "user-9",
          department: "d9",
          labelIds: ["l1", "l9"],
          milestone: "m9",
          project: "p9",
          status: "s9",
        },
        references,
      ),
    ).toEqual({ ...DEFAULT_BOARD_PREFERENCES, labelIds: ["l1"] });
    expect(
      sanitizeBoardReferences(
        { ...DEFAULT_BOARD_PREFERENCES, assignee: "group:g9" },
        references,
      ).assignee,
    ).toBe("all");
  });
});
