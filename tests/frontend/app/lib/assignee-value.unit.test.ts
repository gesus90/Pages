import { expect, it } from "vitest";

import {
  splitAssigneeValue,
  toAssigneeValue,
  toGroupAssigneeValue,
} from "@/app/lib/assignee-value";

it("encodes a group, a person or nobody as one select value", () => {
  expect(toAssigneeValue({ assigneeGroupId: "team", assigneeId: null })).toBe(
    "group:team",
  );
  expect(toAssigneeValue({ assigneeGroupId: null, assigneeId: "user" })).toBe(
    "user",
  );
  expect(toAssigneeValue({ assigneeGroupId: null, assigneeId: null })).toBe("");
});

it("decodes a select value into the person and group fields of a form", () => {
  expect(splitAssigneeValue("group:team")).toEqual({
    assigneeGroupId: "team",
    assigneeId: "",
  });
  expect(splitAssigneeValue("user")).toEqual({
    assigneeGroupId: "",
    assigneeId: "user",
  });
  expect(splitAssigneeValue("")).toEqual({
    assigneeGroupId: "",
    assigneeId: "",
  });
});

it("builds the value that picks a group and reads it back", () => {
  const value = toGroupAssigneeValue("team");

  expect(value).toBe("group:team");
  expect(splitAssigneeValue(value).assigneeGroupId).toBe("team");
});
