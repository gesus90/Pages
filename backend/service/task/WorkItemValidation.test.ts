import { expect, it } from "vitest";

import {
  trimOrNull,
  validateDescription,
  validateTitle,
  validateWorkItemText,
} from "./WorkItemValidation";

import { WorkItemValidationError } from "@/backend/error/WorkItemErrors";
import { WORK_ITEM_LIMITS } from "@/definition/Task";

it("trims a value and treats empty values as missing", () => {
  expect(trimOrNull("  a ")).toBe("a");
  expect(trimOrNull("")).toBeNull();
  expect(trimOrNull(null)).toBeNull();
  expect(trimOrNull(undefined)).toBeNull();
});

it("accepts a title within its limit", () => {
  expect(() =>
    validateTitle("x".repeat(WORK_ITEM_LIMITS.titleLength)),
  ).not.toThrow();
});

it("refuses an empty or too long title", () => {
  expect(() => validateTitle("")).toThrow(WorkItemValidationError);
  expect(() =>
    validateTitle("x".repeat(WORK_ITEM_LIMITS.titleLength + 1)),
  ).toThrow(WorkItemValidationError);
});

it("accepts a description within its limit and refuses a longer one", () => {
  expect(() =>
    validateDescription("x".repeat(WORK_ITEM_LIMITS.descriptionLength)),
  ).not.toThrow();
  expect(() =>
    validateDescription("x".repeat(WORK_ITEM_LIMITS.descriptionLength + 1)),
  ).toThrow(WorkItemValidationError);
});

it("checks title and description together", () => {
  expect(() => validateWorkItemText("t", "d")).not.toThrow();
  expect(() => validateWorkItemText("", "d")).toThrow(WorkItemValidationError);
  expect(() =>
    validateWorkItemText(
      "t",
      "x".repeat(WORK_ITEM_LIMITS.descriptionLength + 1),
    ),
  ).toThrow(WorkItemValidationError);
});
