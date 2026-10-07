import { describe, expect, it } from "vitest";

import {
  splitAssigneeValue,
  toAssigneeValue,
  toGroupAssigneeValue,
} from "@/app/lib/assignee-value";

describe("assignee select values", () => {
  it("encodes a person, a group or nobody as one value", () => {
    expect(toAssigneeValue({ assigneeGroupId: null, assigneeId: "u1" })).toBe(
      "u1",
    );
    expect(toAssigneeValue({ assigneeGroupId: "g1", assigneeId: null })).toBe(
      "group:g1",
    );
    expect(toAssigneeValue({ assigneeGroupId: null, assigneeId: null })).toBe(
      "",
    );
    expect(toGroupAssigneeValue("g1")).toBe("group:g1");
  });

  it("splits a value back into the two exclusive fields", () => {
    expect(splitAssigneeValue("u1")).toEqual({
      assigneeGroupId: "",
      assigneeId: "u1",
    });
    expect(splitAssigneeValue("group:g1")).toEqual({
      assigneeGroupId: "g1",
      assigneeId: "",
    });
    expect(splitAssigneeValue("")).toEqual({
      assigneeGroupId: "",
      assigneeId: "",
    });
  });
});
